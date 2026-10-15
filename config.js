// Supabase project for AI Powered Tactics. Both values are public by design: the database's
// row level security rules decide who can read or change what. Never put a secret or service_role key here.
window.APT_CONFIG = {
  url: 'https://kvefpqigpqprxfelesrb.supabase.co',
  key: 'sb_publishable_GVY0NOJ3upPsqoGztDN_4g_6g2I67hJ',
  // where account confirmation emails send people when they sign up from the iOS app
  siteUrl: 'https://randomedp.github.io/AI-Powered-Tactics/',
  // where highlight clips play from: the Cloudflare R2 bucket's public address (clips are uploaded through the clip-store
  // edge function, which holds the R2 key). Public by design, like the clips themselves.
  clipsUrl: 'https://pub-256c81d54c3443eb8e0e013b111d2668.r2.dev',
  // Gaffer's App Store page, once it's live (https://apps.apple.com/app/id...). Empty until then: the guests' page says
  // to search the App Store instead.
  appStore: '',
  // The shop takes real payments only once Stripe's live key is set (and SHOP_LIVE on the shop function). Until then the
  // shop says it's in test mode.
  shopLive: false
};
