export class IECBus {
  constructor() {
    this.devices = [];
    this.controllerAtn = false;
    this.controllerClk = false;
    this.controllerData = false;
    this.deviceClk = 0;
    this.deviceData = 0;
    this.atn = true;
    this.clk = true;
    this.data = true;
    this.notifying = false;
    this.trace = null;
  }

  attach(device) {
    const id = this.devices.length;
    this.devices.push(device);
    return id;
  }

  setControllerOutputs(atn, clk, data) {
    this.controllerAtn = !!atn;
    this.controllerClk = !!clk;
    this.controllerData = !!data;
    this.update();
  }

  setDeviceLines(id, clk, data) {
    const bit = 1 << id;
    this.deviceClk = clk ? this.deviceClk | bit : this.deviceClk & ~bit;
    this.deviceData = data ? this.deviceData | bit : this.deviceData & ~bit;
    this.update();
  }

  update() {
    const atn = !this.controllerAtn;
    const clk = !(this.controllerClk || this.deviceClk !== 0);
    const data = !(this.controllerData || this.deviceData !== 0);
    if (atn === this.atn && clk === this.clk && data === this.data) {
      return;
    }
    this.atn = atn;
    this.clk = clk;
    this.data = data;
    if (this.trace) {
      this.trace(atn, clk, data);
    }
    if (this.notifying) {
      this.pendingNotify = true;
      return;
    }
    this.notifying = true;
    do {
      this.pendingNotify = false;
      for (const device of this.devices) {
        device.onBusChange(this);
      }
    } while (this.pendingNotify);
    this.notifying = false;
  }

  reset() {
    this.controllerAtn = false;
    this.controllerClk = false;
    this.controllerData = false;
    this.deviceClk = 0;
    this.deviceData = 0;
    this.update();
    for (const device of this.devices) {
      if (device.reset) {
        device.reset();
      }
    }
  }
}
