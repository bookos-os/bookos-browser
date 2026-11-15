#!/usr/bin/bash
# Hace el .rpm de Aether Browser: ./empaquetar.sh [versión]  → build/rpm/RPMS/
#
# No se compila Firefox (ver README): el paquete lleva las FUENTES en
# /usr/share/bookos-browser y el montaje se hace en la máquina que lo instala,
# en %post. Montarlo aquí y empaquetar el árbol no vale: lleva una copia del
# ejecutable que tiene que casar con el libxul.so de quien lo instala, y se
# rompería en el siguiente «dnf upgrade». Por eso hay además un %triggerin
# sobre firefox: dnf lo ejecuta cada vez que se instala o actualiza Firefox y
# vuelve a montar, que es lo que a mano hacía instalar.sh.
set -euo pipefail

aqui=$(dirname "$(realpath "$0")")
version=${1:-$(date +%Y.%m.%d)}
top=$aqui/build/rpm
rm -rf "$top"
mkdir -p "$top"/{SOURCES,SPECS}

# Del árbol de trabajo y no de un commit, para poder empaquetar lo que se está
# probando; sí se respeta .gitignore.
(cd "$aqui" && git ls-files -co --exclude-standard -z \
  | tar --null -T - --transform "s|^|bookos-browser-$version/|" -czf "$top/SOURCES/bookos-browser-$version.tar.gz")

cat > "$top/SPECS/bookos-browser.spec" <<EOF
Name:           bookos-browser
Version:        $version
Release:        1%{?dist}
Summary:        Aether Browser, el navegador de BookOS
License:        MPL-2.0
BuildArch:      noarch
Source0:        %{name}-%{version}.tar.gz
# construir.sh corre en el sistema que instala, así que sus herramientas son
# dependencias de ejecución, no de construcción.
Requires:       firefox
Requires:       ImageMagick
Requires:       zip
Requires:       unzip
Requires:       bash

# Lo que hay en /usr/lib64 lo genera %post; rpm no debe buscarle dependencias
# ni quejarse de que sea noarch.
%global montaje /usr/lib64/bookos-browser
%global debug_package %{nil}

%description
Firefox del sistema con la interfaz, las políticas y las prefs de privacidad
de BookOS. Se monta como un árbol de enlaces sobre /usr/lib64/firefox.

%prep
%autosetup

%build

%install
fuentes=%{buildroot}%{_datadir}/%{name}
mkdir -p "\$fuentes"
cp -a bookos bookos.cfg construir.sh data defaults distribution marca "\$fuentes/"
# El lanzador busca la instalación del sistema en /usr/local; en el paquete
# está en otro sitio.
sed 's|/usr/local/lib/bookos-browser|%{montaje}|' bookos-browser > lanzador
install -Dm755 lanzador %{buildroot}%{_bindir}/%{name}
install -Dm644 data/bookos-browser.svg %{buildroot}%{_datadir}/icons/hicolor/scalable/apps/%{name}.svg
sed 's|^Icon=.*$|Icon=%{name}|' data/bookos-browser.desktop > escritorio
install -Dm644 escritorio %{buildroot}%{_datadir}/applications/%{name}.desktop
mkdir -p %{buildroot}%{montaje}

# Sin %post: el trigger también salta al instalar este paquete si Firefox ya
# está, y con los dos se montaba dos veces. Corre con el Firefox nuevo ya en
# disco.
%triggerin -- firefox
%{_datadir}/%{name}/construir.sh %{montaje} >/dev/null

%preun
# Solo al desinstalar de verdad (\$1 == 0), no al actualizar este paquete.
if [ "\$1" -eq 0 ]; then rm -rf %{montaje}; fi

%files
%{_bindir}/%{name}
%{_datadir}/%{name}
%{_datadir}/icons/hicolor/scalable/apps/%{name}.svg
%{_datadir}/applications/%{name}.desktop
%dir %{montaje}
EOF

rpmbuild --define "_topdir $top" -bb "$top/SPECS/bookos-browser.spec"
find "$top/RPMS" -name '*.rpm'
