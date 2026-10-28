#!/usr/bin/env bash
# Prepares macOS code signing on a CI runner, the way the update spike validated it: the
# certificate is trusted for code signing (an untrusted self-signed identity is not valid for
# codesign), and electron-builder imports the identity from the p12 file into its own
# temporary keychain. A Developer ID certificate works the same way.
#
# Usage: tools/release/import-mac-certificate.sh <base64 p12> <p12 password> <p12 file>
# Writes the p12 file for CSC_LINK and prints the identity name for `-c.mac.identity`.
set -euo pipefail

p12_base64="$1"
p12_password="$2"
p12="$3"
certificate="$(dirname "$p12")/signing.pem"

(umask 077 && printf '%s' "$p12_base64" | base64 --decode >"$p12")
openssl pkcs12 -in "$p12" -passin "pass:$p12_password" -nokeys -clcerts -out "$certificate"
identity=$(openssl x509 -in "$certificate" -noout -subject -nameopt multiline |
  sed -n 's/^ *commonName *= *//p')
if [[ -z "$identity" ]]; then
  echo "The certificate has no common name" >&2
  exit 1
fi
sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain "$certificate"
echo "$identity"
