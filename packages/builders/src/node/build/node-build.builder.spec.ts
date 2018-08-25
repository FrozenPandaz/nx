import { normalize } from '@angular-devkit/core';
import { TestLogger } from '@angular-devkit/architect/testing';
import BuildNodeBuilder from './node-build.builder';
import { BuildNodeBuilderOptions } from './node-build.builder';
import * as ts from 'typescript';
import { of } from 'rxjs';
import { ProgressPlugin } from 'webpack';
import ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
import CircularDependencyPlugin = require('circular-dependency-plugin');

describe('NodeBuildBuilder', () => {
  let builder: BuildNodeBuilder;
  let testOptions: BuildNodeBuilderOptions;
  let expectedWebpackConfig: any;

  beforeEach(() => {
    spyOn(ts, 'parseJsonConfigFileContent').and.returnValue({
      options: {
        paths: {
          '@npmScope/libraryName': ['libs/libraryName/src/index.ts']
        }
      }
    });
    builder = new BuildNodeBuilder({
      host: <any>{},
      logger: new TestLogger('test'),
      workspace: <any>{
        root: '/root'
      },
      architect: <any>{}
    });
    testOptions = {
      main: 'apps/nodeapp/src/main.ts',
      tsConfig: 'apps/nodeapp/tsconfig.app.json',
      outputPath: 'dist/apps/nodeapp',
      watch: false,
      optimization: false,
      externalDependencies: 'all',
      showCircularDependencies: false,
      fileReplacements: [],
      progress: false,
      statsJson: false,
      extractLicenses: false
    };
    expectedWebpackConfig = {
      entry: ['/root/apps/nodeapp/src/main.ts'],
      output: {
        filename: 'main.js',
        path: '/root/dist/apps/nodeapp',
        libraryTarget: 'commonjs'
      },
      mode: 'development',
      module: {
        rules: [
          {
            loader: 'ts-loader',
            options: {
              configFile: '/root/apps/nodeapp/tsconfig.app.json',
              experimentalWatchApi: true,
              transpileOnly: true
            },
            test: /\.ts$/
          }
        ]
      },
      node: {
        Buffer: false,
        __dirname: false,
        __filename: false,
        console: false,
        global: false,
        process: false
      },
      performance: {
        hints: false
      },
      resolve: {
        alias: {
          '@npmScope/libraryName': '/root/libs/libraryName/src/index.ts'
        },
        extensions: ['.ts', '.js']
      },
      plugins: jasmine.any(Array),
      externals: [jasmine.any(Function)],
      target: 'node',
      watch: false
    };
  });

  it('should call the webpack builder', done => {
    const runWebpack = spyOn(
      builder.webpackBuilder,
      'runWebpack'
    ).and.returnValue(
      of({
        success: true
      })
    );
    builder
      .run({
        root: normalize('/root'),
        projectType: 'application',
        builder: '@nrwl/builders:node-build',
        options: testOptions
      })
      .subscribe({
        next: result => {
          expect(result).toEqual({
            success: true,
            outfile: '/root/dist/apps/nodeapp/main.js'
          });
          const webpackConfig = runWebpack.calls.first().args[0];
          // Check everything except for plugins which has issues with toEqual
          expect({
            ...webpackConfig
          }).toEqual(expectedWebpackConfig);
          const callback = jest.fn();
          webpackConfig.externals[0](null, '@angular/core', callback);
          expect(callback).toHaveBeenCalledWith(null, 'commonjs @angular/core');

          // Check Plugins
          expect(webpackConfig.plugins[0].options).toEqual({
            tsconfig: '/root/apps/nodeapp/tsconfig.app.json',
            workers: ForkTsCheckerWebpackPlugin.TWO_CPUS_FREE
          });
        },
        complete: done
      });
  });

  it('should call the webpack builder with options', done => {
    const runWebpack = spyOn(
      builder.webpackBuilder,
      'runWebpack'
    ).and.returnValue(
      of({
        success: true
      })
    );
    builder
      .run({
        root: normalize('/root'),
        projectType: 'application',
        builder: '@nrwl/builders:node-build',
        options: {
          ...testOptions,
          watch: true,
          maxWorkers: 1,
          optimization: true,
          externalDependencies: ['@angular/core'],
          showCircularDependencies: true,
          fileReplacements: [
            {
              replace: 'apps/nodeapp/src/environments/environment.ts',
              with: 'apps/nodeapp/src/environments/environment.prod.ts'
            }
          ],
          progress: true,
          statsJson: true,
          extractLicenses: true
        }
      })
      .subscribe({
        next: result => {
          expect(result).toEqual({
            success: true,
            outfile: '/root/dist/apps/nodeapp/main.js'
          });
          const webpackConfig = runWebpack.calls.first().args[0];
          // Check everything except for plugins which has issues with toEqual
          expect({
            ...webpackConfig
          }).toEqual({
            ...expectedWebpackConfig,
            resolve: {
              ...expectedWebpackConfig.resolve,
              alias: {
                '/root/apps/nodeapp/src/environments/environment.ts':
                  '/root/apps/nodeapp/src/environments/environment.prod.ts',
                '@npmScope/libraryName': '/root/libs/libraryName/src/index.ts'
              }
            },
            watch: true,
            mode: 'production',
            optimization: {
              minimize: false
            }
          });

          const callback = jest.fn();
          // @angular/core is listed as an external dependency, it should not be bundled
          webpackConfig.externals[0](null, '@angular/core', callback);
          expect(callback).toHaveBeenCalledWith(null, 'commonjs @angular/core');

          // @nrwl/nx is not listed an an external dependency, it should be bundled
          webpackConfig.externals[0](null, '@nrwl/nx', callback);
          expect(callback).toHaveBeenCalledWith();
          expect(callback).not.toHaveBeenCalledWith(null, 'commonjs @nrwl/nx');

          // Check Plugins
          expect(webpackConfig.plugins[0].options).toEqual({
            tsconfig: '/root/apps/nodeapp/tsconfig.app.json',
            workers: 1
          });
          expect(webpackConfig.plugins[1]).toEqual(new ProgressPlugin());

          expect(webpackConfig.plugins[2].options).toEqual(
            jasmine.objectContaining({
              outputFilename: '3rdpartylicenses.txt',
              pattern: /.*/,
              perChunkOutput: false,
              suppressErrors: true
            })
          );

          expect(webpackConfig.plugins[3]).toEqual(
            new CircularDependencyPlugin({
              exclude: /[\\\/]node_modules[\\\/]/
            })
          );
          expect(webpackConfig.plugins.length).toEqual(4);
        },
        complete: done
      });
  });
});
