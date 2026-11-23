# Garceslab Anime TV

> **Garceslab Anime** está basado en [Seanime](https://github.com/5rahim/seanime) (de 5rahim) y
> en [Seanime Tenji](https://github.com/AlkindiX/seanime-tv) (de AlkindiX). Es un proyecto
> independiente y no oficial, centrado en televisores LG con webOS (probado en webOS 23). Su objetivo es añadir perfiles locales sin
> cuenta de AniList y hasta 3 reproducciones simultáneas con TorBox (en desarrollo). No está
> afiliado ni respaldado por Seanime ni por Seanime Tenji: por favor, **no reportes problemas de
> Garceslab Anime en sus repositorios**. Licencia GPL-3.0, como los proyectos originales (algunos
> módulos nativos son MPL-2.0, ver [LICENSES.md](LICENSES.md)).
>
> *English:* based on Seanime and Seanime Tenji (GPL-3.0). An independent, unofficial project
> focused on LG webOS TVs (tested on webOS 23). Not affiliated with or endorsed by either
> project; please don't report Garceslab Anime issues to them.

Este repositorio contiene la **app de TV**, derivada de
[AlkindiX/seanime-tv](https://github.com/AlkindiX/seanime-tv) a partir de la v0.4.0 (commit
`0df9c6d`; se conserva su historial de git). El servidor y la web están en
[garceslab-anime](https://github.com/YTvictorworld/garceslab-anime).

- Se mantiene **de forma independiente**: no sigue a los proyectos originales de forma automática. Los cambios están en
  [MODIFICATIONS.md](MODIFICATIONS.md) y el aviso de licencia en [NOTICE](NOTICE).
- **Compilar para webOS:** `npm ci && npm run build:webos` → `dist/webos/*.ipk`. Instrucciones de
  instalación en [webos/README.md](webos/README.md). El CI publica el `.ipk` como artefacto.
- Si la zona horaria de la TV está mal, se puede fijar al compilar con
  `EXPO_PUBLIC_TV_TIME_ZONE=<zona IANA>` (opción local; el CI no la fija).

---

*Lo que sigue es el README original de Seanime Tenji, sin cambios.*

<p align="center">
<a href="https://seanime.app/">
<img src="src/assets/images/logo_2.png" alt="preview" width="70px"/>
</a>
</p>

<h1 align="center"><b>Seanime Tenji</b></h1>

<p align="center">
<img src="https://s3.seanime.app/sea/tenji-banner.webp" alt="preview" width="100%"/>
</p>

<p align="center">
  <a href="https://seanime.app/docs">Documentation</a> |
  <a href="https://github.com/5rahim/seanime-tenji/releases">Latest release</a> |
  <a href="https://seanime.app/docs/policies">Copyright</a>
</p>

<div align="center">
  <a href="https://github.com/sponsors/5rahim">
    <img src="https://img.shields.io/static/v1?label=Sponsor&style=flat-square&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86" alt="" />
  </a>
</div>


<h5 align="center">
Consider becoming a sponsor if you like the project! ⭐️
</h5>

## About

Seanime Tenji is a mobile and TV **client app** for your Seanime media server with a **built-in player** and **offline support** for streaming anime and reading manga.

> [!IMPORTANT]
> Seanime Tenji does not provide, host, or distribute any media content. Users are responsible for obtaining media through legal means and complying with their local laws. </strong>

## Features

- **Cross-platform**: Available on Android, AndroidTV, iOS, tvOS and LG webOS ([experimental](webos/README.md))
- **Built-in media player**: Powered by libmpv, supports most anime codecs and formats
- **Playback Options**: Support for server local files, torrent, debrid and online streaming
- **Manga Reader**: Read and download chapters on iOS and Android
- **Download locally**: Download anime episodes and manga chapters to your mobile device
- **External Player Support**: Support for opening media in mobile external players such as VLC, MX Player, Outplayer, etc.
- **Offline Mode**: Access your downloaded anime episodes and manga chapters without an internet connection

## Development

Seanime Tenji is built with React Native and Expo. Detailed guides on setup and local development workflows can be found in the [Contributing Guide](CONTRIBUTING.md).

---

> [!NOTE]
> For copyright-related requests, please contact the maintainer using the contact information provided on [the website](https://seanime.app/docs/policies).
