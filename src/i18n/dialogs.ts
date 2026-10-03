import { getLanguage } from './store'
import { translate } from './translate'

/** Keep browser confirmation and alert copy in the selected interface language. */
export function uiText(message: string): string {
  return translate(message, getLanguage())
}
