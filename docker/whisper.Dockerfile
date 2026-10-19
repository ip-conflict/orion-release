ARG WHISPER_VERSIONE=v1.9.5
ARG WHISPER_COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037

FROM node:24-trixie-slim AS compila
ARG WHISPER_VERSIONE
ARG WHISPER_COMMIT
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git cmake g++ make \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$WHISPER_VERSIONE" https://github.com/ggml-org/whisper.cpp /src \
 && [ "$(git -C /src rev-parse HEAD)" = "$WHISPER_COMMIT" ] \
 && sed -i -E '/ggml_add_cpu_backend_variant\((sse42|sandybridge|ivybridge|piledriver|cannonlake|cascadelake|icelake|cooperlake|zen4|alderlake|sapphirerapids)[ )]/d' /src/ggml/src/CMakeLists.txt \
 && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release -DCMAKE_BUILD_RPATH_USE_ORIGIN=ON \
      -DGGML_NATIVE=OFF -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON -DGGML_OPENMP=OFF -DBUILD_SHARED_LIBS=ON \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF \
 && lavori=$(awk -v n="$(nproc)" '/MemAvailable/ { j = int($2 / 700000); print (j < 1 ? 1 : (j > n ? n : j)) }' /proc/meminfo) \
 && cmake --build /build -j"$lavori" --target whisper-cli \
 && mkdir /opt/whisper && cp -P /build/bin/whisper-cli /build/bin/*.so* /opt/whisper/

FROM scratch
ARG WHISPER_VERSIONE
COPY --from=compila /opt/whisper /opt/whisper
LABEL org.opencontainers.image.title="whisper.cpp per ORION" \
      org.opencontainers.image.version="$WHISPER_VERSIONE" \
      org.opencontainers.image.licenses="MIT"
