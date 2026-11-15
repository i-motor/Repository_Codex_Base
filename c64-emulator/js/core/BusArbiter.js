export class BusArbiter {
  resolve(vicRequest, cpuIntent, externalRDYHigh = true) {
    const kind = cpuIntent.kind;
    if (kind !== 'read' && kind !== 'write' && kind !== 'idle') {
      throw new RangeError(`Unbekannte CPU-Busoperation: ${kind}`);
    }
    const baHigh = !Boolean(vicRequest.baLow);
    const aecHigh = !Boolean(vicRequest.stealsPhi2);
    const rdyHigh = baHigh && Boolean(externalRDYHigh);
    if (!aecHigh && kind === 'write') {
      throw new Error('Buskonflikt: VIC-Übernahme überschneidet CPU-Schreibzyklus');
    }
    const cpuBusActive = aecHigh && kind !== 'idle';
    return {
      baHigh,
      aecHigh,
      rdyHigh,
      owner: aecHigh ? (cpuBusActive ? 'cpu' : 'none') : 'vic',
      cpuBusActive,
      advanceCPU: cpuBusActive && (kind === 'write' || rdyHigh),
      repeatedRead: cpuBusActive && kind === 'read' && !rdyHigh
    };
  }
}
