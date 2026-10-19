// The watch staying on screen during a game (Ethan, October 2026: it kept going back to the watch face mid-game). Only a
// workout session keeps a watch app in front when the wrist is raised again; the physical-therapy runtime session it used
// before only runs behind the watch face. The parts that can't be built off a Mac, checked as files; tests/watch/main.swift
// checks when the brain wants the screen (MatchState.staysOnScreen).
import { suite, ROOT } from './lib.mjs';
import fs from 'fs';
import path from 'path';
const { check, eq, done } = suite('watch stays on screen, as files');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const model = read('ios/App/Watch/MatchModel.swift'), plist = read('ios/App/Watch/Info.plist'), pbx = read('ios/App/App.xcodeproj/project.pbxproj');

const modes = (plist.match(/<key>WKBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/) || [])[1] || '';
check(modes.includes('<string>workout-processing</string>'), 'the watch app may run a workout');
check(modes.includes('<string>physical-therapy</string>'), 'and keeps the runtime session for when Health is turned down');
for (const k of ['NSHealthShareUsageDescription', 'NSHealthUpdateUsageDescription']) check(new RegExp(`<key>${k}</key>\\s*<string>[^<]{20,}</string>`).test(plist), `it says why it asks Health (${k})`);
check(/<key>com\.apple\.developer\.healthkit<\/key>\s*<true\/>/.test(read('ios/App/Watch/Watch.entitlements')), 'the watch app has HealthKit');
eq((pbx.match(/CODE_SIGN_ENTITLEMENTS = Watch\/Watch\.entitlements;/g) || []).length, 2, 'signed with it in Debug and Release');
for (const id of ['com.randomedp.aipoweredtactics', 'com.randomedp.aipoweredtactics.Clip']) {
  const blocks = pbx.split('isa = XCBuildConfiguration;').filter((b) => b.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${id};`));
  check(blocks.length && blocks.every((b) => !b.includes('Watch.entitlements')), `${id} isn't given it`);
}

// what the model does with it
check(/HKWorkoutSession\(healthStore:/.test(model) && /activityType = \.soccer/.test(model), 'a football workout holds the screen');
check(/state\?\.staysOnScreen/.test(model), 'for as long as the brain says (set-up to full time)');
check(/requestAuthorization\(toShare: \[kind\], read: nil\)/.test(model), 'Health is only asked to let it start a workout, nothing read');
check(!/HKWorkoutBuilder|HKLiveWorkoutBuilder|finishWorkout|\.save\(/.test(model), 'and nothing is saved to Health');
check(/workout\?\.end\(\)/.test(model), 'the workout ends when the game does');
check(/workoutOff = true/.test(model) && /guard workout === session/.test(model), 'one ended by something else (another workout app) is not started again that game');
check(/WKExtendedRuntimeSession\(\)/.test(model), 'without Health it falls back to the runtime session');
check(/Apple Health/.test(read('privacy.html')), 'the privacy page says what happens with Health');
await done();
