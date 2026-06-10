/// <reference types="vite/client" />
import type { PantryApi } from '../../shared/ipc'

declare global {
  interface Window {
    pantry: PantryApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

export {}
