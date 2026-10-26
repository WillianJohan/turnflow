import { renderMd } from '../markdown'

export function Markdown({ text }: { text: string }): React.JSX.Element {
  return <div className="readme" dangerouslySetInnerHTML={{ __html: renderMd(text) }} />
}
