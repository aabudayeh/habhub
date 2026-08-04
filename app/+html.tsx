import { ScrollViewStyleReset } from 'expo-router/html';
import { PropsWithChildren } from 'react';

export default function RootHtml({ children }: PropsWithChildren) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content="#081B49" />
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
        <meta property="og:image" content="https://habhub.expo.app/habhub-icon.png" />
        <meta property="og:image:width" content="1254" />
        <meta property="og:image:height" content="1254" />
        <meta property="og:image:alt" content="HabHub logo" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Join HabHub" />
        <meta name="twitter:description" content="Track anything. Progress together." />
        <meta name="twitter:image" content="https://habhub.expo.app/habhub-icon.png" />
        <title>HabHub · Track anything. Progress together.</title>
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
