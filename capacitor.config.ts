import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.db36ca024c2b4e0ea58fa351aa767ebf',
  appName: 'Chromecast Bridge',
  webDir: 'dist',
  server: {
    url: 'https://db36ca02-4c2b-4e0e-a58f-a351aa767ebf.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  android: {
    allowMixedContent: true
  }
};

export default config;