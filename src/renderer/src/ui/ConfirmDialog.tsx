import { Button } from './Button'
import { Dialog } from './Dialog'

export function ConfirmDialog({
  title,
  body,
  confirm = 'Confirm',
  cancel = 'Cancel',
  onConfirm,
  onClose,
  preview = false
}: {
  title: string
  body: string
  confirm?: string
  cancel?: string
  onConfirm?(): void
  onClose(): void
  preview?: boolean
}): React.JSX.Element {
  return (
    <Dialog title={title} onClose={onClose} preview={preview}>
      <p>{body}</p>
      <div className="ui-dialog-actions">
        <Button onClick={onClose}>{cancel}</Button>
        <Button
          primary
          onClick={() => {
            onConfirm?.()
            onClose()
          }}
        >
          {confirm}
        </Button>
      </div>
    </Dialog>
  )
}
