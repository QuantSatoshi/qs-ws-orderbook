VERSION=$(git rev-parse HEAD)
echo $VERSION

gsed -i "s/qs-ws-orderbook\.git#.*\"/qs-ws-orderbook\.git#${VERSION}\"/g" ../bitmex_hf/package.json
gsed -i "s/qs-ws-orderbook\.git#.*\"/qs-ws-orderbook\.git#${VERSION}\"/g" ../bitmex_hf/yarn.lock

gsed -i "s/qs-ws-orderbook\.git#.*\"/qs-ws-orderbook\.git#${VERSION}\"/g" ../ex-core/package.json
gsed -i "s/qs-ws-orderbook\.git#.*\"/qs-ws-orderbook\.git#${VERSION}\"/g" ../ex-core/yarn.lock

gsed -i "s/qs-ws-orderbook\.git#.*\"/qs-ws-orderbook\.git#${VERSION}\"/g" ../ammarb/package.json
gsed -i "s/qs-ws-orderbook\.git#.*\"/qs-ws-orderbook\.git#${VERSION}\"/g" ../ammarb/yarn.lock

