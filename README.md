## About This Fork 关于本分支

This fork is developed and maintained by [LCPU](https://github.com/lcpu-club). We try to implement all entreprise features into this fork. We have currently implemented the following features:

- Sandboxed compiles and selecting build image ([#4](https://github.com/lcpu-club/overleaf/pull/4), [#5](https://github.com/lcpu-club/overleaf/pull/5))
- Review and comment ([#12](https://github.com/lcpu-club/overleaf/pull/12))

You can see all local changes at [Commit History](https://github.com/lcpu-club/overleaf/commits/main/).

For instructions on how to deploy Overleaf, see [Quick Start Guide](https://github.com/lcpu-club/overleaf/wiki/Quick-Start-Guide).

Future development roadmap is in [GitHub Projects](https://github.com/orgs/lcpu-club/projects/2). Feel free to share your thoughts in [GitHub Issues](https://github.com/lcpu-club/overleaf/issues) and pull requests are welcomed and *appreciated*. To get started, go to [./development](https://github.com/lcpu-club/overleaf/tree/main/develop).

本分支由[北京大学学生 Linux 俱乐部](https://github.com/lcpu-club)开发并维护。我们致力于将Overleaf中的企业级功能移植入开源分支，目前，我们已经实现了以下功能:

- 编译沙箱及自定义编译镜像 ([#4](https://github.com/lcpu-club/overleaf/pull/4), [#5](https://github.com/lcpu-club/overleaf/pull/5))
- 审阅与评论 ([#12](https://github.com/lcpu-club/overleaf/pull/12))

可在[快速开始](https://github.com/lcpu-club/overleaf/wiki/快速开始)查阅安装指南。

开发计划位于 [GitHub Projects](https://github.com/orgs/lcpu-club/projects/2)，欢迎在 [GitHub Issues](https://github.com/lcpu-club/overleaf/issues) 中提出你的想法。我们欢迎并由衷感谢你的PR。有关开发帮助，请参阅 [./development](https://github.com/lcpu-club/overleaf/tree/main/develop)。

<h1 align="center">
  <br>
  <a href="https://www.overleaf.com"><img src="doc/logo.png" alt="Overleaf" width="300"></a>
</h1>

<h4 align="center">An open-source online real-time collaborative LaTeX editor.</h4>

<p align="center">
  <a href="https://github.com/overleaf/overleaf/wiki">Wiki</a> •
  <a href="https://www.overleaf.com/for/enterprises">Server Pro</a> •
  <a href="#contributing">Contributing</a> •
  <a href="https://mailchi.mp/overleaf.com/community-edition-and-server-pro">Mailing List</a> •
  <a href="#authors">Authors</a> •
  <a href="#license">License</a>
</p>

<img src="doc/screenshot.png" alt="A screenshot of a project being edited in Overleaf Community Edition">
<p align="center">
  Figure 1: A screenshot of a project being edited in Overleaf Community Edition.
</p>

## Community Edition

[Overleaf](https://www.overleaf.com) is an open-source online real-time collaborative LaTeX editor. We run a hosted version at [www.overleaf.com](https://www.overleaf.com), but you can also run your own local version, and contribute to the development of Overleaf.

## Enterprise

If you want help installing and maintaining Overleaf in your lab or workplace, we offer an officially supported version called [Overleaf Server Pro](https://www.overleaf.com/for/enterprises). It also includes more features for security (SSO with LDAP or SAML), administration and collaboration (e.g. tracked changes). [Find out more!](https://www.overleaf.com/for/enterprises)

## Keeping up to date

Sign up to the [mailing list](https://mailchi.mp/overleaf.com/community-edition-and-server-pro) to get updates on Overleaf releases and development.

## Installation

We have detailed installation instructions in the [Overleaf Toolkit](https://github.com/overleaf/toolkit/).

## Upgrading

If you are upgrading from a previous version of Overleaf, please see the [Release Notes section on the Wiki](https://github.com/overleaf/overleaf/wiki#release-notes) for all of the versions between your current version and the version you are upgrading to.

## Overleaf Docker Image

This repo contains two dockerfiles, [`Dockerfile-base`](server-ce/Dockerfile-base), which builds the
`sharelatex/sharelatex-base` image, and [`Dockerfile`](server-ce/Dockerfile) which builds the
`sharelatex/sharelatex` (or "community") image.

The Base image generally contains the basic dependencies like `wget` and
`aspell`, plus `texlive`. We split this out because it's a pretty heavy set of
dependencies, and it's nice to not have to rebuild all of that every time.

The `sharelatex/sharelatex` image extends the base image and adds the actual Overleaf code
and services.

Use `make build-base` and `make build-community` from `server-ce/` to build these images.

We use the [Phusion base-image](https://github.com/phusion/baseimage-docker)
(which is extended by our `base` image) to provide us with a VM-like container
in which to run the Overleaf services. Baseimage uses the `runit` service
manager to manage services, and we add our init-scripts from the `server-ce/runit`
folder.


## Contributing

Please see the [CONTRIBUTING](CONTRIBUTING.md) file for information on contributing to the development of Overleaf.

## Authors

[The Overleaf Team](https://www.overleaf.com/about)

## License

The code in this repository is released under the GNU AFFERO GENERAL PUBLIC LICENSE, version 3. A copy can be found in the [`LICENSE`](LICENSE) file.

Copyright (c) Overleaf, 2014-2024.
