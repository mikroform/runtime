export type ServiceGroup<Name extends keyof Services> = { [K in Name]: Service<K> }

export type Service<Name extends keyof Services> = (
  params: Parameters<Services[Name]>[0],
  modules: Modules,
  errors: Errors,
) => Promisified<ReturnType<Services[Name]>>

export interface Services extends Record<string, (params: any) => any> {}

export interface AppFactory<Config extends Record<string, any> = {}> {
  (services: Services, errors: Errors, config: Config & {appName: string}): Promisified<{
    run(): void | Promise<void>
    dispose?(): void | Promise<void>
  }>
}

export interface Modules extends Record<string, (...args: any) => any> {}

export interface ModuleFactory<
  Key extends keyof Modules,
  Dependencies extends keyof Modules = never,
  Config extends Record<string, any> | undefined = undefined
> {
  (requiredModules: Pick<Modules, Dependencies>, config: Config): {
    name: Key
    action: Modules[Key]
    dispose?: () => Promisified<void>
  }
  require?: Array<string>
}

interface Errors {
  InvalidError: ErrorConstructor
  NoAccessError: ErrorConstructor
  NotExistsError: ErrorConstructor
  AlreadyExistsError: ErrorConstructor
  DeletedError: ErrorConstructor
  LogicError: ErrorConstructor
}

type ErrorConstructor = new(msg?: string, meta?: object) => any

type Promisified<T> = T | Promise<T>
