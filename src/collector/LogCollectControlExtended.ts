import CONSTANTS from '../constants';
import LogCollectControlBase from './LogCollectControlBase';
import utils from "../utils";
import LogCollectorState from "./LogCollectorState";
import type {ExtendedSupportOptions} from "../installLogsCollector.types";
import type {MessageData} from "../types";

/**
 * Collects and dispatches all logs from all tests and hooks.
 */
export default class LogCollectControlExtended extends LogCollectControlBase {
  constructor(protected collectorState: LogCollectorState, protected config: ExtendedSupportOptions) {
    super();
    this.registerCypressBeforeMochaHooksSealEvent();
  }

  register() {
    this.collectorState.setStrict();

    this.registerState();
    this.registerBeforeAllHooks();
    this.registerAfterAllHooks();
    this.registerTests();
    this.registerLogToFiles();
  }

  triggerSendTask(
    buildDataMessage: () => MessageData,
    noQueue: boolean,
    wait: number
  ) {
    if (noQueue) {
      this.debugLog('Sending with debounce.');
      this.debounceNextMochaSuite(Promise.resolve()
        // Need to wait for command log update debounce.
        .then(() => new Promise(resolve => setTimeout(resolve, wait)))
        .then(() => utils.nonQueueTask(CONSTANTS.TASK_NAME, buildDataMessage()))
        .catch(console.error)
      );
    } else {
      // Need to wait for command log update debounce.
      cy.wait(wait, {log: false})
        .then(() => {
          cy.task(CONSTANTS.TASK_NAME, buildDataMessage(), {log: false});
        });
    }
  }

  registerState() {
    const self = this;

    Cypress.on('log:changed', (options) => {
      if (options.state === 'failed') {
        this.collectorState.updateLogStatus(options.id);
      }
    });
    // @ts-ignore
    Cypress.mocha.getRunner().on('test', (test) => {
      this.collectorState.startTest(test);
    });
    // @ts-ignore
    Cypress.mocha.getRunner().on('suite', () => {
      this.collectorState.startSuite();
    });
    // @ts-ignore
    Cypress.mocha.getRunner().on('suite end', () => {
      this.collectorState.endSuite();
    });

    // Keeps track of before and after all hook indexes.
    // @ts-ignore
    Cypress.mocha.getRunner().on('hook', function (hook: any) {
      if (!hook._ctr_hook && !hook.fn._ctr_hook) {
        // After each hooks get merged with the test.
        if (hook.hookName !== "after each") {
          self.collectorState.addNewLogStack();
        }

        // Before each hooks also get merged with the test.
        if (hook.hookName === "before each") {
          self.collectorState.markCurrentStackFromBeforeEach();
        }

        if (hook.hookName === "before all") {
          self.collectorState.incrementBeforeHookIndex();
        } else if (hook.hookName === "after all") {
          self.collectorState.incrementAfterHookIndex();
        }
      }
    });
  }

  registerBeforeAllHooks() {
    const self = this;

    // Logs commands from before all hook if the hook passed.
    // @ts-ignore
    Cypress.mocha.getRunner().on('hook end', function(this: any, hook: any) {
      if (hook.hookName === "before all" && self.collectorState.hasLogsInCurrentStack() && !hook._ctr_hook) {
        self.debugLog('extended: sending logs of passed before all hook');
        self.sendLogsToPrinter(
          self.collectorState.getCurrentLogStackIndex(),
          this.currentRunnable,
          {
            state: 'passed',
            isHook: true,
            title: self.collectorState.getBeforeHookTestTile(),
            consoleTitle: self.collectorState.getBeforeHookTestTile(),
          }
        );
      }
    });

    // Logs commands from before all hooks that failed.
    Cypress.on('before:mocha:hooks:seal', function(this: any) {
      self.prependBeforeAllHookInAllSuites(this.mocha.getRootSuite().suites, function ctrAfterAllPerSuite(this: any) {
        if (
          this.test.parent === this.currentTest.parent // Since we have after all in each suite we need this for nested suites case.
          && this.currentTest.failedFromHookId // This is how we know a hook failed the suite.
          && self.collectorState.hasLogsInCurrentStack()
        ) {
          self.debugLog('extended: sending logs of failed before all hook');
          self.sendLogsToPrinter(
            self.collectorState.getCurrentLogStackIndex(),
            this.currentTest,
            {
              state: 'failed',
              title: self.collectorState.getBeforeHookTestTile(),
              isHook: true
            }
          );
        }
      });
    });
  }

  registerAfterAllHooks() {
    const self = this;

    // Logs commands from after all hooks that passed.
    // @ts-ignore
    Cypress.mocha.getRunner().on('hook end', function (hook: any) {
      if (hook.hookName === "after all" && self.collectorState.hasLogsInCurrentStack() && !hook._ctr_hook) {
        self.debugLog('extended: sending logs of passed after all hook');
        self.sendLogsToPrinter(
          self.collectorState.getCurrentLogStackIndex(),
          hook,
          {
            state: 'passed',
            title: self.collectorState.getAfterHookTestTile(),
            consoleTitle: self.collectorState.getAfterHookTestTile(),
            isHook: true,
            noQueue: true,
          }
        );
      }
    });

    // Logs after all hook commands when a command fails in the hook.
    Cypress.prependListener('fail', function(this: any, error: any) {
      const currentRunnable = this.mocha.getRunner().currentRunnable;

      if (currentRunnable.hookName === 'after all' && self.collectorState.hasLogsInCurrentStack()) {
        // We only have the full list of commands when the suite ends.
        this.mocha.getRunner().prependOnceListener('suite end', () => {
          self.debugLog('extended: sending logs of failed after all hook');
          self.sendLogsToPrinter(
            self.collectorState.getCurrentLogStackIndex(),
            currentRunnable,
            {
              state: 'failed',
              title: self.collectorState.getAfterHookTestTile(),
              isHook: true,
              noQueue: true,
              wait: 8, // Need to wait so that cypress log updates happen.
            }
          );
        });

        // Have to wait for debounce on log updates to have correct state information.
        // Done state is used as callback and awaited in Cypress.fail.
        // @ts-ignore
        Cypress.state('done', async (error: any) => {
          await new Promise(resolve => setTimeout(resolve, 6));
          throw error;
        });
      }

      // @ts-ignore
      Cypress.state('error', error);
      throw error;
    });
  }

  registerTests() {
    const self = this;

    const sendLogsToPrinterForATest = (test: any) => {
      // We take over logging the passing test titles since we need to control when it gets printed so
      // that our logs come after it is printed.
      if (test.state === 'passed') {
        this.printPassingMochaTestTitle(test);
        this.preventNextMochaPassEmit();
      }

      this.sendLogsToPrinter(this.collectorState.getCurrentLogStackIndex(), test, {noQueue: true});
    };

    const testHasAfterEachHooks = (test: any) => {
      do {
        if (test.parent._afterEach.length > 0) {
          return true;
        }
        test = test.parent;
      } while(test.parent);
      return false;
    };

    const isLastAfterEachHookForTest = (test: any, hook: any) => {
      let suite = test.parent;
      do {
        if (suite._afterEach.length === 0) {
          suite = suite.parent;
        } else {
          return suite._afterEach.indexOf(hook) === suite._afterEach.length - 1;
        }
      } while (suite);
      return false;
    };

    // Logs commands form each separate test when after each hooks are present.
    // @ts-ignore
    Cypress.mocha.getRunner().on('hook end', function (hook: any) {
      if (hook.hookName === 'after each') {
        if (isLastAfterEachHookForTest(self.collectorState.getCurrentTest(), hook)) {
          self.debugLog('extended: sending logs for ended test, just after the last after each hook: ' + self.collectorState.getCurrentTest().title);
          sendLogsToPrinterForATest(self.collectorState.getCurrentTest());
        }
      }
    });
    // Logs commands form each separate test when there is no after each hook.
    // @ts-ignore
    Cypress.mocha.getRunner().on('test end', function (test: any) {
      if (!testHasAfterEachHooks(test)) {
        self.debugLog('extended: sending logs for ended test, that has not after each hooks: ' + self.collectorState.getCurrentTest().title);
        sendLogsToPrinterForATest(self.collectorState.getCurrentTest());
      }
    });
    // Logs commands if test was manually skipped.
    // @ts-ignore
    Cypress.mocha.getRunner().on('pending', function (test: any) {
      if (self.collectorState.getCurrentTest() === test) {
        // In case of fully skipped tests we might not yet have a log stack.
        if (self.collectorState.hasLogsInCurrentStack()) {
          self.debugLog('extended: sending logs for skipped test: ' + test.title);
          sendLogsToPrinterForATest(test);
        }
      }
    });
  }

  registerLogToFiles() {
    after(function () {
      cy.wait(50, {log: false});
      cy.task(CONSTANTS.TASK_NAME_OUTPUT, null, {log: false});
    });
  }

  debounceNextMochaSuite(promise: Promise<any>) {
    // @ts-ignore
    const runner = Cypress.mocha.getRunner();

    // Hack to make mocha wait for our logs to be written to console before
    // going to the next suite. This is because 'fail' and 'suite begin' both
    // fire synchronously and thus we wouldn't get a window to display the
    // logs between the failed hook title and next suite title.
    const originalRunSuite = runner.runSuite;
    runner.runSuite = function (...args: any[]) {
      promise
        .catch(() => {/* noop */})
        // We need to wait here as for some reason the next suite title will be displayed to soon.
        .then(() => new Promise(resolve => setTimeout(resolve, 6)))
        .then(() => {
          originalRunSuite.apply(runner, args);
          runner.runSuite = originalRunSuite;
        });
    }
  }

  registerCypressBeforeMochaHooksSealEvent() {
    // Hack to have dynamic after hook per suite.
    // The onSpecReady in cypress is called before the hooks are 'condensed', or so
    // to say sealed and thus in this phase we can register dynamically hooks.
    const oldOnSpecReady = (Cypress as any).onSpecReady;
    (Cypress as any).onSpecReady = function () {
      Cypress.emit('before:mocha:hooks:seal');
      oldOnSpecReady(...arguments);
    };
  }

  prependBeforeAllHookInAllSuites(rootSuites: any, hookCallback: (this: any) => void) {
    const recursiveSuites = (suites: any) => {
      if (suites) {
        suites.forEach((suite: any) => {
          if (suite.isPending()) {
            return
          }
          suite.afterAll(hookCallback);
          // Make sure our hook is first so that other after all hook logs come after
          // the failed before all hooks logs.
          const hook = suite._afterAll.pop();
          suite._afterAll.unshift(hook);
          // Don't count this in the hook index and logs.
          hook._ctr_hook = true;

          recursiveSuites(suite.suites);
        });
      }
    };
    recursiveSuites(rootSuites);
  }

  printPassingMochaTestTitle(test: any) {
    if (Cypress.config('isTextTerminal')) {
      Cypress.emit('mocha', 'pass', {
        "id": test.id,
        "order": test.order,
        "title": test.title,
        "state": "passed",
        "type": "test",
        "duration": test.duration,
        "wallClockStartedAt": test.wallClockStartedAt,
        "timings": test.timings,
        "file": null,
        "invocationDetails": test.invocationDetails,
        "final": true,
        "currentRetry": test.currentRetry(),
        "retries": test.retries(),
      })
    }
  }

  preventNextMochaPassEmit() {
    const oldAction = Cypress.action;
    Cypress.action = function (actionName: string, ...args: any[]) {
      if (actionName === 'runner:pass') {
        Cypress.action = oldAction;
        return;
      }

      return oldAction.call(Cypress, actionName, ...args);
    };
  }

  debugLog(message: any) {
    if (this.config.debug) {
      console.log(CONSTANTS.DEBUG_LOG_PREFIX + message);
    }
  }
}