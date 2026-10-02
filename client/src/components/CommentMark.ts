import { Mark, mergeAttributes } from '@tiptap/core'

export interface CommentOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      /** Wrap the current selection in a comment mark with the given id. */
      setComment: (commentId: string) => ReturnType
      /** Remove the comment mark with the given id across the doc. */
      unsetComment: (commentId: string) => ReturnType
    }
  }
}

/**
 * A mark that highlights a commented text range and carries `commentId`
 * (the stable anchor shared with the Comment row in the database). The mark
 * travels with the text through concurrent edits via Yjs, so the highlight
 * stays on the right words even as the document changes around it.
 */
export const CommentMark = Mark.create<CommentOptions>({
  name: 'comment',
  inclusive: false,
  excludes: '', // allow overlapping comments

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-comment-id'),
        renderHTML: (attrs) =>
          attrs.commentId ? { 'data-comment-id': attrs.commentId } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'comment-mark' }),
      0,
    ]
  },

  addCommands() {
    return {
      setComment:
        (commentId: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId }),
      unsetComment:
        (commentId: string) =>
        ({ tr, state, dispatch }) => {
          const { doc } = state
          const type = state.schema.marks.comment
          let changed = false
          doc.descendants((node, pos) => {
            if (!node.isText) return
            node.marks.forEach((mark) => {
              if (mark.type === type && mark.attrs.commentId === commentId) {
                tr.removeMark(pos, pos + node.nodeSize, type)
                changed = true
              }
            })
          })
          if (changed && dispatch) dispatch(tr)
          return changed
        },
    }
  },
})
