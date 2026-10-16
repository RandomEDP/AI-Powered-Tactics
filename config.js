// Supabase project for AI Powered Tactics. Both values are public by design: the database's
// row level security rules decide who can read or change what. Never put a secret or service_role key here.
window.APT_CONFIG = {
  url: 'https://kvefpqigpqprxfelesrb.supabase.co',
  key: 'sb_publishable_GVY0NOJ3upPsqoGztDN_4g_6g2I67hJ',
  // where account confirmation emails send people when they sign up from the iOS app
  siteUrl: 'https://randomedp.github.io/AI-Powered-Tactics/',
  // Gaffer's own web address for links that go to people outside the app (a friendly's personal links, the guests' link
  // after a game among the squad), Ethan's domain (October 2026). Never the GitHub address,
  // which must never be sent to anyone (Ethan); with this empty, the buttons that send those links don't show.
  linkUrl: 'https://gaffermanager.app/',
  // where highlight clips play from: the Cloudflare R2 bucket's public address (clips are uploaded through the clip-store
  // edge function, which holds the R2 key). Public by design, like the clips themselves.
  clipsUrl: 'https://pub-256c81d54c3443eb8e0e013b111d2668.r2.dev',
  // Gaffer's App Store page, once it's live (https://apps.apple.com/app/id...). Empty until then: the guests' page says
  // to search the App Store instead.
  appStore: '',
  // Gaffer's App Clip link, once the App Clip is live on the App Store: App Store Connect shows it (App Clip, Default App
  // Clip Link: https://appclip.apple.com/id?p=com.randomedp.aipoweredtactics.Clip). Empty until then. With it, an iPhone
  // opening a friendly's personal link on the website is offered the App Clip.
  appClip: '',
  // The shop takes real payments only once Stripe's live key is set (and SHOP_LIVE on the shop function). Until then the
  // shop says it's in test mode.
  shopLive: false,
  // Rewarded ads (the free tier): Gaffer's AdMob rewarded ad unit (its app id is in ios/App/App/Info.plist,
  // GADApplicationIdentifier). Ad unit ids are public by design (they're in every app that shows ads). Real ads are on
  // (October 2026). test: true makes the phone play Google's own test ads instead (the plugin swaps the unit), which earn
  // nothing and are safe to tap; with it on, ad_settings.trust_app has to be on too, as test ads never call the server.
  ads: { rewarded: 'ca-app-pub-2627873247729818/1194270899', test: false }
};
