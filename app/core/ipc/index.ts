// The composition root's two imports. Errors, progress channels and router
// types are imported from the modules that declare them, never through here.
export { IpcRouter } from "./router"
export { attachIpcRouter } from "./register"
