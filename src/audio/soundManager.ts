import { Storage } from '../util/storage';

class SoundManager {
  private ctx: AudioContext | null = null;
  private muted: boolean = Storage.isMuted();
  private unlocked = false;

  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;

  public unlock(): void {
    if (this.unlocked) return;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }

      if (this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.unlocked = true;
        }).catch(() => {
          // Will retry on next interaction
        });
      } else {
        this.unlocked = true;
      }
    } catch (err) {
      console.warn('WebAudio initialization error:', err);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    Storage.setMuted(muted);
    if (this.muted && this.engineGain) {
      this.engineGain.gain.setValueAtTime(0, this.ctx?.currentTime || 0);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private playTone(freq: number, type: OscillatorType, duration: number, gain = 0.15): void {
    if (this.muted || !this.ctx) return;
    this.unlock();

    try {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gainNode.gain.setValueAtTime(gain, this.ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch {
      // Ignore audio synthesis errors on older or restricted browsers
    }
  }

  public playCountdownTick(): void {
    // 3, 2, 1: crisp 440 Hz arcade blip
    this.playTone(440, 'square', 0.1, 0.2);
  }

  public playCountdownGo(): void {
    // GO!: high 880 Hz triumphant chime
    this.playTone(880, 'square', 0.35, 0.25);
  }

  public playClick(): void {
    // Short retro UI click
    this.playTone(600, 'triangle', 0.04, 0.1);
  }

  public playCorrect(): void {
    if (this.muted || !this.ctx) return;
    this.unlock();

    try {
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      notes.forEach((freq, idx) => {
        const osc = this.ctx!.createOscillator();
        const gainNode = this.ctx!.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, this.ctx!.currentTime + idx * 0.08);

        gainNode.gain.setValueAtTime(0, this.ctx!.currentTime);
        gainNode.gain.setValueAtTime(0.2, this.ctx!.currentTime + idx * 0.08);
        gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx!.currentTime + idx * 0.08 + 0.2);

        osc.connect(gainNode);
        gainNode.connect(this.ctx!.destination);

        osc.start(this.ctx!.currentTime + idx * 0.08);
        osc.stop(this.ctx!.currentTime + idx * 0.08 + 0.25);
      });
    } catch {
      // Ignore
    }
  }

  public playWrong(): void {
    if (this.muted || !this.ctx) return;
    this.unlock();

    try {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, this.ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(90, this.ctx.currentTime + 0.3);

      gainNode.gain.setValueAtTime(0.25, this.ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);

      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.35);
    } catch {
      // Ignore
    }
  }

  public playLap(): void {
    if (this.muted || !this.ctx) return;
    this.unlock();

    try {
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((freq, idx) => {
        const osc = this.ctx!.createOscillator();
        const gainNode = this.ctx!.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, this.ctx!.currentTime + idx * 0.07);

        gainNode.gain.setValueAtTime(0, this.ctx!.currentTime);
        gainNode.gain.setValueAtTime(0.2, this.ctx!.currentTime + idx * 0.07);
        gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx!.currentTime + idx * 0.07 + 0.25);

        osc.connect(gainNode);
        gainNode.connect(this.ctx!.destination);

        osc.start(this.ctx!.currentTime + idx * 0.07);
        osc.stop(this.ctx!.currentTime + idx * 0.07 + 0.3);
      });
    } catch {
      // Ignore
    }
  }

  public playRaceEnd(): void {
    if (this.muted || !this.ctx) return;
    this.unlock();

    try {
      const notes = [880, 784, 659, 523];
      notes.forEach((freq, idx) => {
        const osc = this.ctx!.createOscillator();
        const gainNode = this.ctx!.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, this.ctx!.currentTime + idx * 0.12);

        gainNode.gain.setValueAtTime(0, this.ctx!.currentTime);
        gainNode.gain.setValueAtTime(0.18, this.ctx!.currentTime + idx * 0.12);
        gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx!.currentTime + idx * 0.12 + 0.3);

        osc.connect(gainNode);
        gainNode.connect(this.ctx!.destination);

        osc.start(this.ctx!.currentTime + idx * 0.12);
        osc.stop(this.ctx!.currentTime + idx * 0.12 + 0.35);
      });
    } catch {
      // Ignore
    }
  }

  private grassOsc: OscillatorNode | null = null;
  private grassGain: GainNode | null = null;
  private lastLowFuelBeep = 0;

  public startEngine(): void {
    if (this.engineOsc || !this.ctx || this.muted) return;
    try {
      this.engineOsc = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();

      this.engineOsc.type = 'triangle';
      this.engineOsc.frequency.setValueAtTime(65, this.ctx.currentTime);

      this.engineGain.gain.setValueAtTime(0.06, this.ctx.currentTime);

      this.engineOsc.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);

      this.engineOsc.start();
    } catch {
      // Ignore
    }
  }

  public updateEnginePitch(speedRatio: number): void {
    if (!this.engineOsc || !this.ctx || this.muted) return;
    try {
      const minFreq = 65;
      const maxFreq = 210;
      const targetFreq = minFreq + (maxFreq - minFreq) * Math.max(0, Math.min(1, speedRatio));
      this.engineOsc.frequency.setValueAtTime(targetFreq, this.ctx.currentTime);
    } catch {
      // Ignore
    }
  }

  public stopEngine(): void {
    if (!this.engineOsc) return;
    try {
      this.engineOsc.stop();
      this.engineOsc.disconnect();
      this.engineGain?.disconnect();
    } catch {
      // Ignore
    }
    this.engineOsc = null;
    this.engineGain = null;
    this.stopGrassRumble();
  }

  public updateGrassRumble(isOffroad: boolean): void {
    if (this.muted || !this.ctx) {
      this.stopGrassRumble();
      return;
    }

    if (isOffroad) {
      if (!this.grassOsc) {
        try {
          this.grassOsc = this.ctx.createOscillator();
          this.grassGain = this.ctx.createGain();

          this.grassOsc.type = 'sawtooth';
          this.grassOsc.frequency.setValueAtTime(45, this.ctx.currentTime);

          this.grassGain.gain.setValueAtTime(0.08, this.ctx.currentTime);

          this.grassOsc.connect(this.grassGain);
          this.grassGain.connect(this.ctx.destination);

          this.grassOsc.start();
        } catch {
          // Ignore
        }
      }
    } else {
      this.stopGrassRumble();
    }
  }

  public stopGrassRumble(): void {
    if (!this.grassOsc) return;
    try {
      this.grassOsc.stop();
      this.grassOsc.disconnect();
      this.grassGain?.disconnect();
    } catch {
      // Ignore
    }
    this.grassOsc = null;
    this.grassGain = null;
  }

  public playLowFuelBeep(): void {
    const now = Date.now();
    // Throttle beep to at most once every 1.5 seconds
    if (now - this.lastLowFuelBeep < 1500) return;
    this.lastLowFuelBeep = now;

    this.playTone(740, 'square', 0.1, 0.18);
  }
}

export const sounds = new SoundManager();
