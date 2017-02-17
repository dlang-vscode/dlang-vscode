'use strict';

import * as path from 'path';
import * as cp from 'child_process';
import * as rl from 'readline';
import * as vsc from 'vscode';
import * as ast from './ast';
import * as rep from './report';
import * as util from './util';

export default class Dscanner {
    public static toolDirtory = '';
    public static toolFile = '';
    public static collection: vsc.DiagnosticCollection;
    private static _collectionKeys = new Map<vsc.Diagnostic, string>();
    private _dscanner: cp.ChildProcess;

    public static get collectionKeys() {
        return Dscanner._collectionKeys;
    }

    public constructor(
        private _document: vsc.TextDocument,
        private _token: vsc.CancellationToken,
        private _operation: util.Operation
    ) {
        if (this._operation === util.Operation.Lint) {
            this.lint();
        } else {
            this._dscanner = cp.spawn(path.join(Dscanner.toolDirtory, Dscanner.toolFile), ['--ast']);
        }
    }

    public execute(resolve: Function, reject: Function) {
        let output = '';

        this._token.onCancellationRequested(() => {
            this._dscanner.kill();
            reject();
        });

        this._dscanner.stdout.on('data', (data) => {
            output += data.toString();
        });

        this._dscanner.stdout.on('close', () => {
            ast.parse(output).then((declarations) => {
                resolve(declarations.map((d) => {
                    let line = this._document.lineAt(d.line - 1);
                    return new vsc.SymbolInformation(d.name, d.kind, line.range, this._document.uri,
                        path.relative(vsc.workspace.rootPath, this._document.fileName))
                }));
            });
        });

        this._dscanner.stdin.end(this._document.getText());
    }

    public lint() {
        let output = '';
        let args = ['--report', this._document.fileName];

        if (vsc.workspace.rootPath) {
            args.push('--config', path.join(vsc.workspace.rootPath, 'dscanner.ini'));
        }

        this._dscanner = cp.spawn(path.join(Dscanner.toolDirtory, Dscanner.toolFile), args);

        this._dscanner.stdout.on('data', (data) => {
            output += data.toString();
        });

        this._dscanner.stdout.on('close', () => {
            try {
                let report: rep.Report = JSON.parse(output.replace(/\\\\"/g, '\\"'));
                let diagnostics = report.issues.map((issue) => {
                    let position = new vsc.Position(issue.line - 1, issue.column - 1);
                    let range = this._document.getWordRangeAtPosition(position);

                    if (!range) {
                        range = new vsc.Range(new vsc.Position(issue.line - 1, issue.column - 1),
                            new vsc.Position(issue.line - 1, issue.column));
                    }

                    let diagnostic = new vsc.Diagnostic(range, issue.message, rep.getSeverity(issue.key));

                    Dscanner._collectionKeys.set(diagnostic, issue.key);
                    return diagnostic;
                });

                Dscanner.collection.set(this._document.uri, diagnostics);
            } catch (err) { }
        });
    }
};
