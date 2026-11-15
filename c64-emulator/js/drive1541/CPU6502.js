import { CPU6510 } from '../core/CPU6510.js';

export class CPU6502 extends CPU6510 {
  constructor(interrupts) {
    super(interrupts);
  }
}
