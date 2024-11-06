/**
 * This file used for adding types to package interfaces that are not included
 * in the package's types.
 */

declare namespace Cypress {
  import { Log } from "./src/installLogsCollector";

  interface Cypress {
    TerminalReport: {
      getLogs(format: 'txt'): string | null;
      getLogs(format: 'json'): string | null;
      getLogs(format?: 'none' = 'none'): Log[] | null;
    }

    onSpecReady(...args: any[]): void;

    mocha: {
      getRunner(): Mocha.Runner
      getRootSuite(): Mocha.Suite
    }
  }
}

declare namespace Mocha {
  interface InvocationDetails {
    relativeFile?: string
    fileUrl?: string
  }

  interface Hook {
    hookName: string
    _ctr_hook: boolean
  }

  interface Runnable {
    hookName: string
    invocationDetails: InvocationDetails
    id: string
    order: unknown
    wallClockStartedAt: unknown
    timings: unknown
  }

  interface Suite {
    invocationDetails: InvocationDetails
  }

  interface Test {
    failedFromHookId?: unknown
  }
}
