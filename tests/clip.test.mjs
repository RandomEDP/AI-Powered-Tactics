// Gaffer's App Clip (ios/App/Clip): the parts that can't be built off a Mac, checked as files. Its values match the
// app's config.js, it's in the Xcode project and embedded in the app, it and the app share one app group under the same
// key the full app reads (ClipHandoffPlugin, SceneDelegate), and it only ever uses the public key. tests/clip/main.swift
// runs its logic; friendly.test.mjs plays the handover in the app; friendlydb.test.mjs the database's side.
import { suite, ROOT } from './lib.mjs';
import fs from 'fs';
import path from 'path';
const { check, eq, done } = suite('App Clip, as files');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const logic = read('ios/App/Clip/ClipLogic.swift'), config = read('config.js'), pbx = read('ios/App/App.xcodeproj/project.pbxproj');
const swiftVal = (name) => (logic.match(new RegExp(`static let ${name} = "([^"]*)"`)) || [])[1];
const jsVal = (name) => (config.match(new RegExp(`${name}: '([^']*)'`)) || [])[1];

for (const [s, j] of [['url', 'url'], ['key', 'key'], ['clipsUrl', 'clipsUrl']]) eq(swiftVal(s), jsVal(j), `the App Clip's ${s} is config.js's ${j}`);
check(/^sb_publishable_/.test(swiftVal('key')), 'and its key is the publishable one');
check(!/service_role|sb_secret_/.test(logic + read('ios/App/Clip/ClipApp.swift')), 'never a secret key');

// the Xcode project
check(/productType = "com\.apple\.product-type\.application\.on-demand-install-capable"/.test(pbx), 'there is an App Clip target');
check(/PRODUCT_BUNDLE_IDENTIFIER = com\.randomedp\.aipoweredtactics\.Clip;/.test(pbx), 'its bundle id is the app\'s with .Clip on the end');
check(/dstPath = "\$\(CONTENTS_FOLDER_PATH\)\/AppClips";/.test(pbx) && /Clip\.app in Embed App Clips/.test(pbx), 'it is embedded in the app (AppClips)');
const appTarget = pbx.match(/\/\* App \*\/ = \{\s*isa = PBXNativeTarget;[\s\S]*?\};/)[0];
check(/Embed App Clips/.test(appTarget) && (appTarget.match(/PBXTargetDependency/g) || []).length === 2, 'the app builds it first and copies it in');
for (const f of ['ClipApp.swift', 'ClipLogic.swift']) check(pbx.includes(`/* ${f} in Sources */ = {isa = PBXBuildFile`), `${f} is built`);
check((pbx.match(/IPHONEOS_DEPLOYMENT_TARGET = 16\.0;/g) || []).length === 2, 'it needs iOS 16 (the app still runs on 15)');
eq((pbx.match(/\{/g) || []).length, (pbx.match(/\}/g) || []).length, 'the project file\'s braces balance');
const ids = pbx.match(/^\t\t([0-9A-F]{24}) \/\*/gm).map((x) => x.trim().slice(0, 24));
eq(ids.length, new Set(ids).size, 'no object id is used twice');

// one app group, one key
const group = 'group.com.randomedp.aipoweredtactics';
for (const f of ['ios/App/Clip/Clip.entitlements', 'ios/App/App/App.entitlements']) check(read(f).includes(`<string>${group}</string>`), `${f} has the shared app group`);
check(read('ios/App/Clip/Clip.entitlements').includes('$(AppIdentifierPrefix)com.randomedp.aipoweredtactics</string>'), 'the App Clip names Gaffer as its app');
check(read('ios/App/App/App.entitlements').includes('$(AppIdentifierPrefix)com.randomedp.aipoweredtactics.Clip</string>'), 'and Gaffer names its App Clip');
check(read('ios/App/Clip/Info.plist').includes('<key>NSAppClip</key>'), 'the App Clip says it is one');
const plugin = read('plugins/reel-cutter/ios/Sources/ReelCutterPlugin/ClipHandoffPlugin.swift'), scene = read('ios/App/App/SceneDelegate.swift');
eq(swiftVal('group'), group, 'the App Clip keeps the link in that group');
check(plugin.includes(`"${group}"`) && scene.includes(`"${group}"`), 'where the full app looks for it, and where it keeps an App Clip link that opened it');
check(plugin.includes('"gaffer.link"') && scene.includes('"gaffer.link"') && swiftVal('linkKey') === 'gaffer.link', 'under the same key');
check(/jsName = "ClipHandoff"/.test(plugin) && read('index.html').includes("plugin('ClipHandoff')"), 'and the web app asks that plugin');

// the database call it makes is open to someone with no account, and only that one
const mig = read('supabase/migrations/0041_friendly_preview.sql');
check(/grant execute on function public\.friendly_preview\(uuid\) to anon, authenticated;/.test(mig), 'friendly_preview is the one call it makes with no account');
check(logic.includes('/rest/v1/rpc/friendly_preview'), 'and that is the call it makes');
await done();
