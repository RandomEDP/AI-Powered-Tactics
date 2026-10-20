// Apple's tracking question (App Tracking Transparency). App Review turned 1.1 down twice (builds 290 and before) because
// it couldn't find it: it was only asked just before the first ad, which a reviewer never reaches. Now the iPhone app asks
// as soon as it's on screen, before Google's ads are started. These parts can't run off a Mac, so they're checked as files;
// ads.test.mjs plays the ads themselves.
import { suite, ROOT } from './lib.mjs';
import fs from 'fs';
import path from 'path';
const { check, done } = suite('Apple\'s tracking question, as files');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const scene = read('ios/App/App/SceneDelegate.swift'), plist = read('ios/App/App/Info.plist'), app = read('index.html');

check(/import AppTrackingTransparency/.test(scene), 'the app\'s scene uses Apple\'s tracking framework');
const active = (scene.match(/func sceneDidBecomeActive\([\s\S]*?\n    \}\n/) || [''])[0];
check(active.length > 0, 'it asks when Gaffer comes on screen (sceneDidBecomeActive: with scenes, the app delegate\'s own is never called)');
check(/requestTrackingAuthorization/.test(active), 'and that is where the question is asked');
check(/trackingAuthorizationStatus == \.notDetermined/.test(active), 'only while it has never been answered');
check(/DispatchQueue\.main\.asyncAfter/.test(active), 'on the main thread, a moment after the app is active (asked sooner, iOS can drop it unseen)');
check(/applicationState == \.active/.test(active), 'and only if Gaffer is still on screen then');
check(/status == \.notDetermined[\s\S]*trackingAsked = false/.test(active), 'if iOS didn\'t show it, it asks again next time');
check(!/AppTrackingTransparency|requestTrackingAuthorization/.test(read('ios/App/App/AppDelegate.swift')), 'not also from the app delegate (it would be asked twice)');

const why = (plist.match(/<key>NSUserTrackingUsageDescription<\/key>\s*<string>([^<]+)<\/string>/) || [])[1] || '';
check(why.length > 40, 'Info.plist says what the question is for');
check(/ad/.test(why) && !/5-a-side/i.test(why), 'in Gaffer\'s words: it is about the ads');

// the web app's own ask before an ad stays as the back-up, and never asks once it's been answered
const setup = (app.match(/async function adSetup\([\s\S]*?\n  \}\n/) || [''])[0];
check(/trackingAuthorizationStatus\(\)[\s\S]*notDetermined[\s\S]*requestTrackingAuthorization\(\)/.test(setup), 'before an ad, the app still asks if it never was');
done();
