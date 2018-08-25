import {
  NodeExecuteBuilder,
  NodeExecuteBuilderOptions
} from './node-execute.builder';
import { TestLogger } from '@angular-devkit/architect/testing';
import { normalize } from '@angular-devkit/core';
import { of } from 'rxjs';
import { cold } from 'jasmine-marbles';
jest.mock('child_process');
let { fork } = require('child_process');
jest.mock('tree-kill');
let treeKill = require('tree-kill');

class MockArchitect {
  getBuilderConfiguration() {
    return {
      config: 'testConfig'
    };
  }
  run() {
    return cold('--a--b--a', {
      a: {
        success: true,
        outfile: 'outfile.js'
      },
      b: {
        success: false,
        outfile: 'outfile.js'
      }
    });
  }
  getBuilderDescription() {
    return of({
      description: 'testDescription'
    });
  }
  validateBuilderOptions() {
    return of({
      builderConfig: 'testBuilderConfig'
    });
  }
}

describe('NodeExecuteBuilder', () => {
  let builder: NodeExecuteBuilder;
  let architect: MockArchitect;
  let testOptions: NodeExecuteBuilderOptions;

  beforeEach(() => {
    fork.mockReturnValue({
      pid: 123
    });
    treeKill.mockImplementation((pid, signal, callback) => {
      callback();
    });
    architect = new MockArchitect();
    builder = new NodeExecuteBuilder({
      workspace: <any>{
        root: '/root'
      },
      logger: new TestLogger('test'),
      host: <any>{},
      architect: <any>architect
    });
    testOptions = {
      inspect: true,
      args: [],
      buildTarget: 'nodeapp:build'
    };
  });

  it('should build the application and start the built file', () => {
    const getBuilderConfiguration = spyOn(architect, 'getBuilderConfiguration');
    expect(
      builder.run({
        root: normalize('/root'),
        projectType: 'application',
        builder: '@nrwl/builders:node-execute',
        options: testOptions
      })
    ).toBeObservable(
      cold('--a--b--a', {
        a: {
          success: true,
          outfile: 'outfile.js'
        },
        b: {
          success: false,
          outfile: 'outfile.js'
        }
      })
    );
    expect(getBuilderConfiguration).toHaveBeenCalledWith({
      project: 'nodeapp',
      target: 'build',
      overrides: {
        watch: true
      }
    });
    expect(fork).toHaveBeenCalledWith('outfile.js', [], {
      execArgv: ['--inspect']
    });
    expect(treeKill).toHaveBeenCalledTimes(1);
    expect(fork).toHaveBeenCalledTimes(2);
  });

  it('should build the application and start the built file with options', () => {
    expect(
      builder.run({
        root: normalize('/root'),
        projectType: 'application',
        builder: '@nrwl/builders:node-execute',
        options: {
          ...testOptions,
          inspect: false,
          args: ['arg1', 'arg2']
        }
      })
    ).toBeObservable(
      cold('--a--b--a', {
        a: {
          success: true,
          outfile: 'outfile.js'
        },
        b: {
          success: false,
          outfile: 'outfile.js'
        }
      })
    );
    expect(fork).toHaveBeenCalledWith('outfile.js', ['arg1', 'arg2'], {
      execArgv: []
    });
  });
});
