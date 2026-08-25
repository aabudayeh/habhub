import { ScrollViewStyleReset } from 'expo-router/html';
import { PropsWithChildren } from 'react';

const appOrigin =
  process.env.EXPO_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ||
  'https://habhub.expo.app';

const webShellStyles = `
  :root {
    --habhub-shell-background: #F4F7FB;
    background-color: var(--habhub-shell-background);
  }

  html, body, #root {
    width: 100%;
    height: 100%;
    min-height: 0;
    margin: 0;
    overflow: hidden;
    background-color: var(--habhub-shell-background);
  }

  /*
   * iOS Safari's legacy 100vh includes browser chrome and can leave a stale
   * strip between the React Navigation scene and its bottom bar. Keep the
   * single app viewport fixed to the dynamic visual viewport instead. The
   * safe-area provider remains responsible for the top and bottom insets.
   */
  @supports (height: 100dvh) {
    html, body {
      height: 100dvh;
    }
  }

  body {
    overscroll-behavior: none;
  }

  #root {
    position: relative;
    isolation: isolate;
  }

  #root {
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  #root input,
  #root textarea,
  #root [contenteditable="true"],
  #root [role="textbox"] {
    -webkit-user-select: text;
    user-select: text;
    -webkit-touch-callout: default;
  }
`;

export default function RootHtml({ children }: PropsWithChildren) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#F4F7FB" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="HabHub" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/habhub-icon.png" />
        <meta
          name="description"
          content="HabHub is a private, customizable tracker for you and your friends."
        />
        <meta property="og:title" content="Join HabHub" />
        <meta property="og:description" content="Track anything. Progress together." />
        <meta property="og:locale" content="en_US" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content={`${appOrigin}/habhub-icon.png`} />
        <meta property="og:image:width" content="1254" />
        <meta property="og:image:height" content="1254" />
        <meta property="og:image:alt" content="HabHub logo" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Join HabHub" />
        <meta name="twitter:description" content="Track anything. Progress together." />
        <meta name="twitter:image" content={`${appOrigin}/habhub-icon.png`} />
        <title>HabHub · Track anything. Progress together.</title>
        <ScrollViewStyleReset />
        <style
          id="habhub-web-shell"
          dangerouslySetInnerHTML={{ __html: webShellStyles }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
