import { jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime'
import { localizedHost } from './localized-host'
export { Fragment } from 'react/jsx-dev-runtime'
export type { JSX } from 'react/jsx-dev-runtime'
export const jsxDEV: typeof reactJsxDEV = (type, props, key, isStaticChildren, source, self) => reactJsxDEV(localizedHost(type), props, key, isStaticChildren, source, self)
