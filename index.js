#!/usr/bin/env -S npx tsx --experimental-vm-modules

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';

import ts from 'typescript';

function resolvePackage(target) {
  if (typeof target === 'string') {
    return [target]
  } else if (Array.isArray(target)) {
    return [target[0], target[1]]
  } else {
    throw new TypeError('package must be a string or a tuple of string and object')
  }
}

async function* packages(target, withImport) {
  let currentIdx = -1

  while (++currentIdx < target.length) {
    const [packageName, packageConfig] = resolvePackage(target[currentIdx])

    if (packageName.startsWith('.') || packageName.startsWith('/')) {
      for await (const filePath of fs.glob(packageName)) {
        const fullPath = packageName.startsWith('.') ?
          path.join(process.cwd(), filePath) :
          filePath
        const stats = await fs.stat(fullPath)

        if (stats.isFile() && (fullPath.endsWith('.js') || fullPath.endsWith('.ts'))) {
          yield [
            fullPath,
            withImport ? await import(fullPath) : await fs.readFile(fullPath, 'utf8'),
            packageConfig,
          ]
        }
      }
    } else {
      const fullPath = path.join(process.cwd(), 'node_modules', packageName);

      yield [
        packageName,
        withImport ? await import(fullPath) : await fs.readFile(fullPath, 'utf8'),
        packageConfig,
      ]
    }
  }
}

if (process.argv[2] !== 'start') {
  throw new Error(`unknown command ${process.argv[2]}`)
}

const config = await fs
  .readFile(path.join(process.cwd(), './mikroform.config.json'), 'utf8')
  .then(JSON.parse)
const appName = config?.appName ?? 'unknown'

function makeError(name, code, message, meta = {}) {
  this.name = name
  this.code = code
  this.message = message
  this.meta = meta
  Error.captureStackTrace(this, this.stack)
}

function InvalidError(message = 'invalid parameters passed', meta = {}) {
  makeError.call(this, 'InvalidError', 'invalid', message, meta)
}

function NoAccessError(message= 'no access', meta = {}) {
  makeError.call(this, 'NoAccessError', 'noAccess', message, meta)
}

function NotExistsError(message = 'entity not exists', meta = {}) {
  makeError.call(this, 'NotExistsError', 'notExists', message, meta)
}

function AlreadyExistsError(message = 'entity already exists', meta = {}) {
  makeError.call(this, 'AlreadyExistsError', 'alreadyExists', message, meta)
}

function DeletedError(message = 'entity deleted', meta = {}) {
  makeError.call(this, 'DeletedError', 'deleted', message, meta)
}

function LogicError(message, meta) {
  makeError.call(this, 'LogicError', 'error', message, meta)
}

const errors = {
  InvalidError,
  NoAccessError,
  NotExistsError,
  AlreadyExistsError,
  DeletedError,
  LogicError,
}

const moduleByPackageName = new Map()
const coreModules = new Set()
const modulesQueue = Array.from(config?.modules ?? [])
const childSymbol = Symbol('child')

for await (const [packageName, module, packageConfig] of packages(modulesQueue, true)) {
  let loadModule

  if (typeof module === 'function') {
    loadModule = module
  } else if (typeof module === 'object' && module.default && typeof module.default === 'function') {
    loadModule = module.default
  } else {
    throw new TypeError('module must be a function or an object with load function')
  }

  moduleByPackageName.set(packageName, [loadModule, packageConfig])

  if (!packageConfig?.[childSymbol]) {
    coreModules.add(packageName)
  }

  for (const requiredPackage of loadModule.require ?? []) {
    const [requiredPackageName, requiredPackageConfig] = resolvePackage(requiredPackage)

    if (!moduleByPackageName.has(requiredPackageName)) {
      modulesQueue.push([requiredPackageName, {[childSymbol]: true, ...requiredPackageConfig}])
    }
  }
}

const visitedModules = new Set()
const ancestorModules = new Set()
const modulesStack = []
const sortedModules = []
let top

for (const [module] of moduleByPackageName.values()) {
  modulesStack.push(module)

  while ((top = modulesStack.at(-1)) !== undefined) {
    const hasNotVisited = !!top.require?.some((subPackageName) =>
      !visitedModules.has(moduleByPackageName.get(subPackageName)))

    if (visitedModules.has(top)) {
      modulesStack.pop()
      ancestorModules.delete(top)
    } else if (ancestorModules.has(top) && modulesStack.indexOf(top) !== modulesStack.length - 1) {
      throw new Error('circular dependency detected')
    } else if (hasNotVisited) {
      ancestorModules.add(top)

      for (const requiredPackage of top.require) {
        modulesStack.push(resolvePackage(requiredPackage)[0])
      }
    } else {
      visitedModules.add(top)
      modulesStack.pop()
      ancestorModules.delete(top)
      sortedModules.push(top)
    }
  }
}

const madeModuleByPackageName = new Map()

for (const packageName of sortedModules) {
  const [module, moduleConfig] = moduleByPackageName.get(packageName)
  const requiredModuleActions = {}

  for (const subPackageName of module.require ?? []) {
    requiredModuleActions[subPackageName] = madeModuleByPackageName.get(subPackageName).action
  }

  madeModuleByPackageName.set(packageName, await module(requiredModuleActions, moduleConfig))
}

const modules = {}

for (const packageName of coreModules) {
  const module = madeModuleByPackageName.get(packageName)

  modules[module.name] = module.action
}

const vmContext = new vm.createContext({})
const serviceByFilePath = new Map()
const coreServices = new Set()
const servicesQueue = Array.from(config?.services ?? [['./services/*.[jt]s']])

for await (const [filePath, serviceFile, packageConfig] of packages(servicesQueue, false)) {
  let srcText = serviceFile

  if (filePath.endsWith('.ts') || filePath.endsWith('.mts') || filePath.endsWith('.cts')) {
    srcText = ts.transpileModule(serviceFile, {
      fileName: filePath,
      compilerOptions: {
        target: 'esnext',
        module: 'esnext',
      },
    }).outputText
  }

  const compiledModule = new vm.SourceTextModule(srcText, {
    identifier: filePath,
    context: vmContext,
  })

  serviceByFilePath.set(filePath, [compiledModule, packageConfig])

  if (!packageConfig?.[childSymbol]) {
    coreServices.add(filePath)
  }

  for (const dependency of compiledModule.moduleRequests ?? []) {
    const fullPath = path.join(filePath, '..', dependency.specifier)

    if (!serviceByFilePath.has(fullPath)) {
      servicesQueue.push([fullPath, {[childSymbol]: true, ...packageConfig}])
    }
  }
  for (const dependency of compiledModule.dependencySpecifiers ?? []) {
    const fullPath = path.join(filePath, '..', dependency)

    if (!serviceByFilePath.has(fullPath)) {
      servicesQueue.push([fullPath, {[childSymbol]: true, ...packageConfig}])
    }
  }
}

const services = {}

for (const service of coreServices) {
  const [compiledModule] = serviceByFilePath.get(service)

  await compiledModule.link(async(specifier) => {
    if (!serviceByFilePath.has(path.join(service, '..', specifier))) {
      throw new Error(`module ${specifier} not found`)
    }

    return serviceByFilePath.get(path.join(service, '..', specifier))[0];
  })
  await compiledModule.evaluate()

  const exports = compiledModule.namespace

  if (typeof exports === 'function') {
    services[exports.name] = (params) => exports(params, modules, errors)
  } else if (typeof exports === 'object') {
    const defaultExport = exports.default

    if (typeof defaultExport === 'function') {
      services[defaultExport.name] = (params) => defaultExport(params, modules, errors)
    }

    let localServices

    if (typeof defaultExport === 'object') {
      localServices = defaultExport
    } else {
      localServices = exports
    }

    for (const name in localServices) {
      services[name] = (params) => localServices[name](params, modules, errors)
    }
  } else {
    throw new TypeError('service must be a function or object of functions')
  }
}

const appByName = new Map()

for await (const [packageName, app, appConfig] of packages(config?.apps ?? [], true)) {
  let loadApp

  if (typeof app === 'function') {
    loadApp = app
  } else if (typeof app === 'object' && app.default && typeof app.default === 'function') {
    loadApp = app.default
  } else {
    throw new TypeError('app must be a function or an object with load function')
  }

  appByName.set(packageName, await loadApp(services, errors, {appName, ...appConfig}))
}

async function dispose() {
  for (const module of madeModuleByPackageName.values()) {
    await module.dispose?.()
  }
  for (const app of appByName.values()) {
    await app.dispose?.()
  }
}

process.on('SIGINT', dispose)
process.on('SIGTERM', dispose)

await Promise.all(Array.from(appByName.values(), (app) => {
  if (typeof app !== 'object' || !app.run || typeof app.run !== 'function') {
    throw new TypeError('app must be an object with run function')
  }

  return app.run()
}));
