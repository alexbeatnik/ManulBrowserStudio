// The hook script of this project. Every run of a hunt in this folder picks
// it up: the engine starts it, and asks it for whatever a hunt needs that a
// browser cannot give. It runs on the Node built into Manul Browser Studio,
// which also provides `manul-browser`, so nothing has to be installed.
//
// What it registers is in support/, one kind of thing per file.

import { serveHooks } from 'manul-browser';

import './support/suite.mjs';
import './support/calls.mjs';
import './support/controls.mjs';

// The engine talks to this process over stdin/stdout, so this goes last.
await serveHooks();
