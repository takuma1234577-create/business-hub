import { jsx as reactJsx, jsxs as reactJsxs } from 'react/jsx-runtime'
import { localizedHost } from './localized-host'
export { Fragment } from 'react/jsx-runtime'
export type { JSX } from 'react/jsx-runtime'
export const jsx: typeof reactJsx = (type, props, key) => reactJsx(localizedHost(type), props, key)
export const jsxs: typeof reactJsxs = (type, props, key) => reactJsxs(localizedHost(type), props, key)
