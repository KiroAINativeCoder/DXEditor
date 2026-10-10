export default function GeminiSparkleIcon({
  size = 14,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      className={`ai-gemini-sparkle ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="gemini-sparkle-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="45%" stopColor="#9B72CB" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      {/* Primary 4-pointed Gemini star */}
      <path
        d="M10.5 3C10.5 7.69 6.69 11.5 2 11.5C6.69 11.5 10.5 15.31 10.5 20C10.5 15.31 14.31 11.5 19 11.5C14.31 11.5 10.5 7.69 10.5 3Z"
        fill="url(#gemini-sparkle-grad)"
      />
      {/* Secondary accent sparkle */}
      <path
        d="M18.5 2C18.5 3.93 16.93 5.5 15 5.5C16.93 5.5 18.5 7.07 18.5 9C18.5 7.07 20.07 5.5 22 5.5C20.07 5.5 18.5 3.93 18.5 2Z"
        fill="url(#gemini-sparkle-grad)"
      />
    </svg>
  )
}
