import './ui.css'
import { BUILTIN_THEMES } from '../../../shared/theme/builtins'
import { Button } from './Button'
import { Chip } from './Chip'
import { ConfirmDialog } from './ConfirmDialog'
import { Counter } from './Counter'
import { Dialog } from './Dialog'
import { Dot } from './Dot'
import { EmptyState } from './EmptyState'
import { IconButton } from './IconButton'
import { Kbd } from './Kbd'
import { ListRow } from './ListRow'
import { Markdown } from './Markdown'
import { Menu } from './Menu'
import { ResizeHandle } from './ResizeHandle'
import { Segmented } from './Segmented'
import { Skeleton } from './Skeleton'
import { StageBar } from './StageBar'
import { Tag } from './Tag'
import { TextField } from './TextField'
import { Toast } from './Toast'
import { Tooltip } from './Tooltip'
import { MIN_COMPONENTS } from './minimal'

const schemeStyle = (id: 'darkest' | 'claro'): React.CSSProperties => {
  const theme = BUILTIN_THEMES[id]
  const style: Record<string, string> = {
    background: 'var(--bg)',
    color: 'var(--fg)',
    padding: '12px'
  }
  for (const [key, value] of Object.entries(theme.ui)) {
    style[`--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`] = value
  }
  return style
}

const samples: Record<(typeof MIN_COMPONENTS)[number], React.ReactNode> = {
  Button: <Button primary>Save</Button>,
  IconButton: <IconButton icon="plus" label="Add" />,
  Dot: <Dot state="waiting" />,
  Tag: (
    <>
      <Tag>Info</Tag>
      <Tag tone="danger">Bloq.</Tag>
    </>
  ),
  Chip: <Chip pressed>Done</Chip>,
  Counter: <Counter value={3} />,
  Kbd: <Kbd>Ctrl</Kbd>,
  Tooltip: (
    <Tooltip label="Search tasks">
      <IconButton icon="search" label="Find" />
    </Tooltip>
  ),
  Menu: <Menu label="Task" open preview items={[{ id: 'close', label: 'Close' }]} />,
  Dialog: (
    <Dialog title="Rename" onClose={() => undefined} preview>
      <Button>Save</Button>
    </Dialog>
  ),
  ConfirmDialog: (
    <ConfirmDialog title="Close" body="Close this task?" onClose={() => undefined} preview />
  ),
  Toast: <Toast action="Undo" />,
  Segmented: (
    <Segmented
      label="Layout"
      value="list"
      options={[
        { id: 'list', label: 'List' },
        { id: 'kanban', label: 'Kanban' }
      ]}
      onChange={() => undefined}
    />
  ),
  TextField: <TextField label="Name" value="" onChange={() => undefined} />,
  ListRow: <ListRow>Ship the login fix</ListRow>,
  ResizeHandle: <ResizeHandle value={288} min={220} max={440} />,
  StageBar: (
    <StageBar
      stages={[
        { id: 's1', short_name: 'Todo', position: 1 },
        { id: 's2', short_name: 'Impl', position: 2 }
      ]}
      current="s2"
      onPick={() => undefined}
    />
  ),
  EmptyState: <EmptyState title="Nothing here" />,
  Skeleton: <Skeleton />,
  Markdown: <Markdown text="Hello" />
}

function Samples(): React.JSX.Element {
  return (
    <>
      {MIN_COMPONENTS.map((name) => (
        <section key={name} data-component={name}>
          {samples[name]}
        </section>
      ))}
    </>
  )
}

export function Catalog(): React.JSX.Element {
  return (
    <div className="ds-catalog">
      <div className="ds-preview" data-scheme="dark" style={schemeStyle('darkest')}>
        <Samples />
      </div>
      <div className="ds-preview" data-scheme="light" style={schemeStyle('claro')}>
        <Samples />
      </div>
    </div>
  )
}
