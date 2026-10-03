import { createContext, useContext } from 'react'
import type { ReactNode, ComponentType, ElementType } from 'react'
import { jsx } from 'react/jsx-runtime'
import { Link, NavLink } from 'react-router-dom'
import { useLanguage } from './store'
import { translate } from './translate'

const SkipTranslation = createContext(false)
const components = new Map<ElementType, ComponentType<Record<string, unknown>>>()
function textChildren(children: unknown, language: ReturnType<typeof useLanguage>): unknown {
  if (typeof children === 'string') return translate(children, language)
  if (Array.isArray(children)) {
    // Adjacent JSX strings and counts form one translatable text run.
    const result: unknown[] = []
    let run: (string | number)[] = []
    const flush = () => {
      if (!run.length) return
      const source = run.join('')
      const translated = translate(source, language)
      result.push(...(translated === source ? run : [translated]))
      run = []
    }
    for (const child of children) {
      if (typeof child === 'string' || typeof child === 'number') run.push(child)
      else { flush(); result.push(textChildren(child, language)) }
    }
    flush()
    return result
  }
  return children
}
/** Stable host wrappers let React own the DOM, preserving form state, refs and events. */
export function localizedHost(tag: ElementType) {
  // Router links render their anchors inside the library's own JSX runtime.
  if (typeof tag !== 'string' && tag !== Link && tag !== NavLink) return tag
  let component = components.get(tag)
  if (component) return component
  component = function LocalizedHost(props: Record<string, unknown>) {
    const language = useLanguage()
    const inheritedSkip = useContext(SkipTranslation)
    const skip = inheritedSkip || props.translate === 'no' || props['data-no-translate'] !== undefined || !!props.contentEditable || (typeof tag === 'string' && ['script', 'style', 'code', 'pre'].includes(tag))
    const translated = { ...props }
    if (!skip) {
      translated.children = tag === 'textarea' ? props.children : textChildren(props.children, language)
      for (const key of ['placeholder', 'title', 'aria-label', 'alt']) {
        if (typeof props[key] === 'string') translated[key] = translate(props[key], language)
      }
      // The browser uses option text as its value when no explicit value is supplied.
      // Preserve that original value even while its visible label is translated.
      if (tag === 'option' && props.value === undefined && typeof props.children === 'string') {
        translated.value = props.children
      }
    }
    const element = jsx(tag as ElementType, translated)
    return skip && !inheritedSkip
      ? jsx(SkipTranslation.Provider, { value: true, children: element as ReactNode })
      : element
  }
  components.set(tag, component)
  return component
}
