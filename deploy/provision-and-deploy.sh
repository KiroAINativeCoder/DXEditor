#!/usr/bin/env bash
#
# DXEditor — provision a t3.nano and deploy, run from YOUR OWN terminal.
#
# WHY YOU RUN THIS (not the agent): the Kiro Crew agent is blocked by a safety
# policy from running mutating AWS EC2 verbs (create-security-group,
# create-key-pair, run-instances, associate-address). Read-only AWS calls are
# fine for it, but creating billable infrastructure is fenced. Your own terminal
# has no such fence.
#
# PREREQS:
#   - AWS CLI configured (same account 564203969946 / us-east-1 is assumed)
#   - DNS A record: devdocs.trailmark.online -> 98.80.117.92  (ADD THIS FIRST)
#   - Run from the repo root: ~/Desktop/Quip
#
# COST: t3.nano ~$3.80/mo on-demand + EBS + data transfer, running until you
# terminate it. The Elastic IP is free while associated.
set -euo pipefail

REGION=us-east-1
KEYNAME=dxeditor-nano
SG=dxeditor-sg
EIP_ALLOC=eipalloc-0af3cb91407818963        # 98.80.117.92 (idle EIP in the account)
DOMAIN=devdocs.trailmark.online
INSTANCE_TYPE=t3.nano
KEYDIR="$HOME/.ssh"
PEM="$KEYDIR/$KEYNAME.pem"

echo "==> 1/7 keypair"
if ! aws ec2 describe-key-pairs --region $REGION --key-names "$KEYNAME" >/dev/null 2>&1; then
  aws ec2 create-key-pair --region $REGION --key-name "$KEYNAME" \
    --query 'KeyMaterial' --output text > "$PEM"
  chmod 600 "$PEM"
  echo "   created $PEM"
else
  echo "   exists"
fi

echo "==> 2/7 security group"
VPC=$(aws ec2 describe-vpcs --region $REGION --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SGID=$(aws ec2 describe-security-groups --region $REGION \
  --filters Name=group-name,Values=$SG Name=vpc-id,Values=$VPC \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)
if [ "$SGID" = "None" ] || [ -z "$SGID" ]; then
  SGID=$(aws ec2 create-security-group --region $REGION --group-name $SG \
    --description "DXEditor nano" --vpc-id $VPC --query 'GroupId' --output text)
  for P in 22 80 443; do
    aws ec2 authorize-security-group-ingress --region $REGION --group-id $SGID \
      --protocol tcp --port $P --cidr 0.0.0.0/0 >/dev/null
  done
  echo "   created $SGID (22,80,443 open; 4001 stays internal, proxied by nginx)"
else
  echo "   exists $SGID"
fi

echo "==> 3/7 latest Ubuntu 22.04 AMI"
AMI=$(aws ec2 describe-images --region $REGION --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
            "Name=state,Values=available" \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text)
echo "   $AMI"

echo "==> 4/7 launch $INSTANCE_TYPE (20GB gp3, 2GB swap via user-data)"
cat > /tmp/dx-userdata.sh <<'UD'
#!/bin/bash
set -e
# Swap FIRST — 0.5GB RAM needs it or everything OOMs.
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
apt-get update -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs nginx
npm install -g pm2
mkdir -p /opt/dxeditor
UD
IID=$(aws ec2 run-instances --region $REGION \
  --image-id $AMI --instance-type $INSTANCE_TYPE \
  --key-name $KEYNAME --security-group-ids $SGID \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]' \
  --user-data file:///tmp/dx-userdata.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=dxeditor-nano}]' \
  --query 'Instances[0].InstanceId' --output text)
echo "   instance $IID — waiting for running..."
aws ec2 wait instance-running --region $REGION --instance-ids $IID

echo "==> 5/7 associate Elastic IP 98.80.117.92"
aws ec2 associate-address --region $REGION --instance-id $IID --allocation-id $EIP_ALLOC >/dev/null
echo "   associated"

echo "==> 6/7 wait for SSH + cloud-init (Node/nginx install) — ~90s"
IP=98.80.117.92
for i in $(seq 1 30); do
  if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "$PEM" ubuntu@$IP 'command -v node >/dev/null && echo ready' 2>/dev/null | grep -q ready; then
    echo "   box ready"; break
  fi
  sleep 10
done

echo "==> 7/7 ship build + server, start services"
# The client inlines VITE_API_URL / VITE_COLLAB_URL at BUILD time, so rebuild
# against the public domain before packaging (the committed dist/ targets
# localhost and would not work remotely).
( cd client && VITE_API_URL="https://$DOMAIN" VITE_COLLAB_URL="wss://$DOMAIN/collab" npm run build )
# Package: built client + server source (no node_modules; installed on box).
TMP=$(mktemp -d)
cp -r client/dist "$TMP/client-dist"
mkdir -p "$TMP/server"
cp -r server/src server/package.json server/package-lock.json "$TMP/server/" 2>/dev/null || true
# copy the env the server needs (edit server/.env on the box if absent)
[ -f server/.env ] && cp server/.env "$TMP/server/.env"
tar -C "$TMP" -czf /tmp/dx-deploy.tgz .
scp -o StrictHostKeyChecking=no -i "$PEM" /tmp/dx-deploy.tgz ubuntu@$IP:/tmp/

ssh -o StrictHostKeyChecking=no -i "$PEM" ubuntu@$IP "DOMAIN=$DOMAIN bash -s" <<'REMOTE'
set -e
sudo mkdir -p /opt/dxeditor && sudo chown ubuntu:ubuntu /opt/dxeditor
tar -C /opt/dxeditor -xzf /tmp/dx-deploy.tgz
cd /opt/dxeditor/server
npm ci --omit=dev || npm install --omit=dev
# tsx to run TS directly (keeps the box build-free)
npm install tsx
# Start API + collab relay under pm2
pm2 delete all 2>/dev/null || true
PORT=4000 pm2 start "npx tsx src/server.ts" --name dx-api
COLLAB_PORT=4001 YJS_DB_DIR=/opt/dxeditor/y-leveldb pm2 start "npx tsx src/collab.ts" --name dx-collab
pm2 save
sudo env PATH=$PATH pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -1 | sudo bash || true

# nginx: serve static client, proxy /api -> 4000, /collab (ws) -> 4001
sudo tee /etc/nginx/sites-available/dxeditor >/dev/null <<NGINX
server {
  listen 80;
  server_name $DOMAIN;
  root /opt/dxeditor/client-dist;
  index index.html;
  location /api/ { proxy_pass http://127.0.0.1:4000; proxy_set_header Host \$host; }
  location /collab {
    proxy_pass http://127.0.0.1:4001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
  }
  location / { try_files \$uri /index.html; }   # SPA fallback for /doc/:id deep links
}
NGINX
sudo ln -sf /etc/nginx/sites-available/dxeditor /etc/nginx/sites-enabled/dxeditor
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
echo "nginx up on http://$DOMAIN"
REMOTE

echo
echo "=================================================================="
echo " Deployed. Now, on the box, enable TLS (needs the A record live):"
echo "   ssh -i $PEM ubuntu@98.80.117.92"
echo "   sudo apt-get install -y certbot python3-certbot-nginx"
echo "   sudo certbot --nginx -d $DOMAIN --redirect -m you@trailmark.online --agree-tos -n"
echo
echo " Then set the client env to the public origin and REBUILD locally,"
echo " or bake VITE_API_URL/VITE_COLLAB_URL before 'npm run build':"
echo "   VITE_API_URL=https://$DOMAIN"
echo "   VITE_COLLAB_URL=wss://$DOMAIN/collab"
echo "=================================================================="
