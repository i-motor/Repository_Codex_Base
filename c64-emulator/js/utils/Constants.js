export const IRQ_SOURCE = Object.freeze({
  VIC: 1,
  CIA1: 2,
  EXPANSION: 4
});

export const NMI_SOURCE = Object.freeze({
  CIA2: 1,
  RESTORE: 2,
  EXPANSION: 4
});

export const VECTORS = Object.freeze({
  NMI: 0xfffa,
  RESET: 0xfffc,
  IRQ: 0xfffe
});

export const IO = Object.freeze({
  VIC_BASE: 0xd000,
  SID_BASE: 0xd400,
  COLOR_RAM_BASE: 0xd800,
  CIA1_BASE: 0xdc00,
  CIA2_BASE: 0xdd00,
  IO1_BASE: 0xde00,
  IO2_BASE: 0xdf00
});

export const VIC_REG = Object.freeze({
  M0X: 0x00,
  M0Y: 0x01,
  MSBX: 0x10,
  CR1: 0x11,
  RASTER: 0x12,
  LPX: 0x13,
  LPY: 0x14,
  ME: 0x15,
  CR2: 0x16,
  MYE: 0x17,
  MEMPTR: 0x18,
  IRQ: 0x19,
  IRQMASK: 0x1a,
  MDP: 0x1b,
  MMC: 0x1c,
  MXE: 0x1d,
  MM: 0x1e,
  MD: 0x1f,
  EC: 0x20,
  B0C: 0x21,
  B1C: 0x22,
  B2C: 0x23,
  B3C: 0x24,
  MM0: 0x25,
  MM1: 0x26,
  M0C: 0x27
});

export const CIA_REG = Object.freeze({
  PRA: 0x0,
  PRB: 0x1,
  DDRA: 0x2,
  DDRB: 0x3,
  TALO: 0x4,
  TAHI: 0x5,
  TBLO: 0x6,
  TBHI: 0x7,
  TOD10: 0x8,
  TODSEC: 0x9,
  TODMIN: 0xa,
  TODHR: 0xb,
  SDR: 0xc,
  ICR: 0xd,
  CRA: 0xe,
  CRB: 0xf
});

export const SID_REG = Object.freeze({
  FCLO: 0x15,
  FCHI: 0x16,
  RESFILT: 0x17,
  MODEVOL: 0x18,
  POTX: 0x19,
  POTY: 0x1a,
  OSC3: 0x1b,
  ENV3: 0x1c
});

export const IEC_COMMAND = Object.freeze({
  LISTEN: 0x20,
  UNLISTEN: 0x3f,
  TALK: 0x40,
  UNTALK: 0x5f,
  SECOND: 0x60,
  CLOSE: 0xe0,
  OPEN: 0xf0
});

export const DEFAULT_DRIVE = 8;

export const ROM_SIZES = Object.freeze({
  basic: 8192,
  kernal: 8192,
  chargen: 4096
});

export const BASIC_START = 0x0801;
