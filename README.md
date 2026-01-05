# @mikroform/runtime

Runtime for Mikroform platform.

## Installation

```bash
npm install -g @mikroform/runtime
```

## Usage

```bash
mikroform start
```

### Service

Function that handles action called via request/reply or publish/subscribe communication. Use `.services` section of
static config to set paths to files with services (for default it's set to `["./services/*.[tj]s"]`).

```js
export async function someService(
  {param1, param2}, // Incoming parameters
  modules, // Modules
  {NotExistsError, AlreadyExistsError} // Object with errors to throw
) {
  // ...
}
```

### App

Connector to outer world which receive messages to perform operation. Use `.apps` section of static config to set paths
to packages with apps and config for them (for default it's set to `[]` therefore nothing runs).

```js
export default async function load(services, errors, config) {
  // ...

  return {
    run() {
      // ...
    },
    dispose() {
      // ...
    },
  };
}
```

### Module

Additional utility functional for example work with SQL-database, Redis, S3, etc. Modules organized in hierarchy and if
somehow it would produce loop service will throw error on start. Use `.modules` section of static config to set paths
to packages with modules and config for them.

```js
export default function load(requiredModules, config) {
  // ...

  return {
    action() {
      // ...
    },
    dispose() {
      // ...
    },
  };
}

load.require = [
  // same as in static config `.modules` section but only external packages
];
```

## Configuration

Static configuration such as paths for modules, services and apps configured via `mikroform.config.json`.

```json
{
  "appName": "my-service-name",
  "modules": [
    "@mikroform/official-module",
    "unofficial-module",
    ["unofficial-module-with-config", {
      "param1": 1
    }],
    "./local-modules/**/index.js"
  ],
  "services": [
    "./services/*.[tj]s"
  ],
  "apps": [
    ["@mikroform/official-app", {
      "param1": 1
    }]
  ]
}
```
