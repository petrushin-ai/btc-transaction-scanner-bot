import { createHash } from "crypto";

import { BASE58_ALPHABET, BECH32, NETWORKS, type Network as NetFromConsts } from "../constants";

export type Network = NetFromConsts;

export function base58checkEncode(version: number, payload: Buffer): string {
  // Preallocate and fill [version|payload|checksum]
  const dataLen = 1 + payload.length;
  const tmp = Buffer.allocUnsafe( dataLen + 4 );
  tmp[0] = version;
  payload.copy( tmp, 1 );
  const checksum = sha256d( tmp.subarray( 0, dataLen ) ).subarray( 0, 4 );
  checksum.copy( tmp, dataLen );
  return base58Encode( tmp );
}

function base58Encode(buffer: Buffer): string {
  // Build BigInt directly from bytes to avoid creating a hex string
  let x = 0n;
  for ( const byte of buffer ) {
    x = (x << 8n) | BigInt( byte );
  }
  const base = 58n;
  let s = "";
  while ( x > 0n ) {
    const mod = Number( x % base );
    s = BASE58_ALPHABET[mod] + s;
    x = x / base;
  }
  // preserve leading zero bytes as '1'
  for ( let i = 0; i < buffer.length && buffer[i] === 0; i++ ) s = `1${ s }`;
  return s || "1";
}

export function sha256d(buf: Buffer): Buffer {
  const h1 = createHash( "sha256" ).update( buf ).digest();
  return createHash( "sha256" ).update( h1 ).digest();
}

// bech32/bech32m encoding (BIP-0173/0350) minimal implementation

function bech32Polymod(values: number[]): number {
  const GENERATORS = BECH32.GENERATORS;
  let chk = 1;
  for ( const v of values ) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for ( let i = 0; i < 5; i++ ) {
      chk ^= ((top >> i) & 1) ? GENERATORS[i] : 0;
    }
  }
  return chk >>> 0;
}

function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for ( let i = 0; i < hrp.length; i++ ) ret.push( hrp.charCodeAt( i ) >> 5 );
  ret.push( 0 );
  for ( let i = 0; i < hrp.length; i++ ) ret.push( hrp.charCodeAt( i ) & 31 );
  return ret;
}

function bech32CreateChecksum(hrp: string, data: number[], spec: "bech32" | "bech32m"): number[] {
  const constVal = spec === "bech32" ? BECH32.CONST_BECH32 : BECH32.CONST_BECH32M;
  const values = [ ...bech32HrpExpand( hrp ), ...data, 0, 0, 0, 0, 0, 0 ];
  const mod = bech32Polymod( values ) ^ constVal;
  const ret: number[] = [];
  for ( let p = 0; p < 6; p++ ) ret.push( (mod >> (5 * (5 - p))) & 31 );
  return ret;
}

function bech32Encode(hrp: string, data: number[], spec: "bech32" | "bech32m"): string {
  const checksum = bech32CreateChecksum( hrp, data, spec );
  const combined = [ ...data, ...checksum ];
  let out = `${ hrp }1`;
  for ( const c of combined ) out += BECH32.CHARSET[c];
  return out;
}

function bech32Decode(addr: string): {
  hrp: string;
  data: number[];
  spec: "bech32" | "bech32m"
} | undefined {
  // Reject mixed case
  const hasLower = addr.toLowerCase() !== addr;
  const hasUpper = addr.toUpperCase() !== addr;
  if ( hasLower && hasUpper ) return undefined;
  const a = addr.toLowerCase();
  const pos = a.lastIndexOf( "1" );
  if ( pos < 1 || pos + 7 > a.length ) return undefined; // need at least hrp(1)+1+6 checksum
  const hrp = a.substring( 0, pos );
  const dataPart = a.substring( pos + 1 );
  const data: number[] = [];
  for ( const ch of dataPart ) {
    const idx = BECH32.CHARSET.indexOf( ch );
    if ( idx === -1 ) return undefined;
    data.push( idx );
  }
  // Verify checksum for both bech32 and bech32m to infer spec
  const values = [ ...bech32HrpExpand( hrp ), ...data ];
  const mod = bech32Polymod( values );
  const isBech32 = mod === BECH32.CONST_BECH32;
  const isBech32m = mod === BECH32.CONST_BECH32M;
  if ( !isBech32 && !isBech32m ) return undefined;
  const spec = isBech32 ? "bech32" : "bech32m";
  return { hrp, data: data.slice( 0, data.length - 6 ), spec };
}

// Convert 8-bit to 5-bit groups
function convertBits(data: Uint8Array, from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to) - 1;
  const maxAcc = (1 << (from + to - 1)) - 1;
  for ( const value of data ) {
    if ( value < 0 || (value >> from) !== 0 ) return [];
    acc = ((acc << from) | value) & maxAcc;
    bits += from;
    while ( bits >= to ) {
      bits -= to;
      ret.push( (acc >> bits) & maxv );
    }
  }
  if ( pad ) {
    if ( bits > 0 ) ret.push( (acc << (to - bits)) & maxv );
  } else if ( bits >= from || ((acc << (to - bits)) & maxv) ) {
    return [];
  }
  return ret;
}

export function encodeWitnessAddress(
  hrp: string,
  witnessVersion: number,
  witnessProgram: Buffer
): string {
  const spec = witnessVersion === 0 ? "bech32" : "bech32m";
  const data: number[] = [ witnessVersion ];
  const prog5 = convertBits( witnessProgram, 8, 5, true );
  return bech32Encode( hrp, [ ...data, ...prog5 ], spec );
}

export function decodeWitnessAddress(addr: string): {
  hrp: string;
  version: number;
  program: Buffer
} | undefined {
  const dec = bech32Decode( addr );
  if ( !dec ) return undefined;
  if ( dec.data.length === 0 ) return undefined;
  const version = dec.data[0];
  if ( version < 0 || version > 16 ) return undefined;
  const prog5 = dec.data.slice( 1 );
  const prog8 = convertBits( Uint8Array.from( prog5 ), 5, 8, false );
  if ( prog8.length < 2 || prog8.length > 40 ) return undefined;
  // Validate spec per BIP-350
  if ( version === 0 && dec.spec !== "bech32" ) return undefined;
  if ( version !== 0 && dec.spec !== "bech32m" ) return undefined;
  return { hrp: dec.hrp, version, program: Buffer.from( prog8 ) };
}

export function getAddressVersionsForNetwork(network: Network): {
  p2pkh: number;
  p2sh: number;
  hrp: string
} {
  return NETWORKS[network];
}

export type DecodedAddress =
  | { kind: "p2pkh"; version: number; hash160: Buffer }
  | { kind: "p2sh"; version: number; hash160: Buffer }
  | { kind: "segwit"; hrp: string; version: number; program: Buffer };

export function decodeAddress(addr: string): DecodedAddress | undefined {
  // Try Base58Check
  const b58 = base58checkDecode( addr );
  if ( b58 ) {
    if (
      b58.payload.length === 20
      && (
        b58.version === NETWORKS.mainnet.p2pkh
        || b58.version === NETWORKS.testnet.p2pkh
      )
    ) {
      return { kind: "p2pkh", version: b58.version, hash160: b58.payload };
    }
    if (
      b58.payload.length === 20
      && (
        b58.version === NETWORKS.mainnet.p2sh
        || b58.version === NETWORKS.testnet.p2sh
      )
    ) {
      return { kind: "p2sh", version: b58.version, hash160: b58.payload };
    }
    return undefined;
  }
  // Try Bech32
  const w = decodeWitnessAddress( addr );
  if ( w ) return { kind: "segwit", hrp: w.hrp, version: w.version, program: w.program };
  return undefined;
}

export function normalizeBech32Case(addr: string): string {
  const dec = bech32Decode( addr );
  if ( !dec ) return addr; // not a valid bech32-like string; return as-is
  // Always normalized to lowercase (BIP-0173 recommendation)
  return addr.toLowerCase();
}

export function validateAndNormalizeAddress(address: string, network?: Network): {
  normalized: string;
  decoded: DecodedAddress
} {
  const decoded = decodeAddress( address );
  if ( !decoded ) throw new Error( "Invalid address format or checksum" );
  let normalized = address;
  if ( decoded.kind === "segwit" ) {
    normalized = normalizeBech32Case( address );
    if ( network ) {
      const versions = getAddressVersionsForNetwork( network );
      if ( decoded.hrp !== versions.hrp ) throw new Error( "Bech32 HRP/network mismatch" );
    }
  } else {
    if ( network ) {
      const versions = getAddressVersionsForNetwork( network );
      if ( decoded.kind === "p2pkh" && decoded.version !== versions.p2pkh ) throw new Error( "Base58 version/network mismatch" );
      if ( decoded.kind === "p2sh" && decoded.version !== versions.p2sh ) throw new Error( "Base58 version/network mismatch" );
    }
  }
  return { normalized, decoded };
}

function base58checkDecode(s: string): { version: number; payload: Buffer } | undefined {
  // Decode Base58
  let x = 0n;
  const base = 58n;
  for ( const ch of s ) {
    const idx = BASE58_ALPHABET.indexOf( ch );
    if ( idx === -1 ) return undefined;
    x = x * base + BigInt( idx );
  }
  // Convert BigInt to bytes
  let tmp: number[] = [];
  while ( x > 0n ) {
    tmp.push( Number( x & 0xffn ) );
    x >>= 8n;
  }
  tmp = tmp.reverse();
  // Restore leading zeros
  for ( let i = 0; i < s.length && s[i] === '1'; i++ ) tmp.unshift( 0 );
  const buf = Buffer.from( tmp );
  if ( buf.length < 5 ) return undefined;
  const version = buf[0];
  const payload = buf.subarray( 1, buf.length - 4 );
  const checksum = buf.subarray( buf.length - 4 );
  const sum = sha256d( buf.subarray( 0, buf.length - 4 ) ).subarray( 0, 4 );
  if ( !checksum.equals( sum ) ) return undefined;
  return { version, payload };
}


