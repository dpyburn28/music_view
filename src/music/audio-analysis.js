/**
 * Live audio analysis for the music window.
 *
 * Isolatable channels (real-time, no ML stems):
 *   full, bass, lowmid, mid, presence, treble,
 *   center (stereo mid), vocals (center + vocal-band M/S extract),
 *   rms, peak, envelope, onset, beat, kick
 *
 * Vocals use stereo mid–side center extraction (most lead vocals are
 * hard-panned center). This is NOT Demucs-quality stem separation —
 * hard-panned doubles, mono masters, and centered guitars still leak.
 *
 * Browser global: window.AudioAnalysis
 */
(function (root) {
    'use strict';

    const WAVE_BINS = 256;
    const FFT_SIZE = 2048;
    const ONSET_HIST = 48;

    const CHANNELS = [
        { id: 'full', label: 'Full mix', kind: 'wave', hz: null, hint: 'Unfiltered mix (L+R mid)' },
        { id: 'bass', label: 'Bass', kind: 'wave', hz: '20–150 Hz', hint: 'Kick / sub / bass body' },
        { id: 'lowmid', label: 'Low-mid', kind: 'wave', hz: '150–500 Hz', hint: 'Warmth, body' },
        { id: 'mid', label: 'Mid', kind: 'wave', hz: '500 Hz–2 kHz', hint: 'Instruments, lower voice' },
        { id: 'presence', label: 'Presence', kind: 'wave', hz: '2–5 kHz', hint: 'Clarity, consonants' },
        { id: 'treble', label: 'Treble', kind: 'wave', hz: '5 kHz+', hint: 'Hats, air, sibilance' },
        {
            id: 'center',
            label: 'Center (M-S)',
            kind: 'wave',
            hz: 'stereo mid',
            hint: 'Stereo center channel — lead vox often live here',
        },
        {
            id: 'vocals',
            label: 'Vocals (center+band)',
            kind: 'wave',
            hz: 'center · 200 Hz–4 kHz',
            hint: 'Mid–side center extract + vocal band. Not ML stems; mono mixes ≈ full band-pass.',
        },
        { id: 'rms', label: 'RMS', kind: 'level', hint: 'Overall loudness' },
        { id: 'peak', label: 'Peak', kind: 'level', hint: 'Instant peak amplitude' },
        { id: 'envelope', label: 'Envelope', kind: 'level', hint: 'Smoothed energy follower' },
        { id: 'onset', label: 'Onset / flux', kind: 'level', hint: 'Transient / spectral flux' },
        { id: 'kick', label: 'Kick onset', kind: 'level', hint: 'Low-band flux (kick hits)' },
        { id: 'beat', label: 'Beat pulse', kind: 'level', hint: 'Peak-picked beat impulse' },
    ];

    const CHANNEL_IDS = CHANNELS.map((c) => c.id);

    function clamp(v, lo, hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    function isChannelId(id) {
        return CHANNEL_IDS.indexOf(id) >= 0;
    }

    function makeLp(cutoffHz, sampleRate) {
        const rc = 1 / (2 * Math.PI * Math.max(1, cutoffHz));
        const dt = 1 / Math.max(1, sampleRate);
        const a = dt / (rc + dt);
        let y = 0;
        return {
            process(x) {
                y += a * (x - y);
                return y;
            },
            reset() { y = 0; },
        };
    }

    function makeBand(loHz, hiHz, sampleRate) {
        const lpLo = makeLp(loHz, sampleRate);
        const lpHi = makeLp(hiHz, sampleRate);
        return {
            process(x) {
                return lpHi.process(x) - lpLo.process(x);
            },
            reset() {
                lpLo.reset();
                lpHi.reset();
            },
        };
    }

    function makeHp(cutoffHz, sampleRate) {
        const lp = makeLp(cutoffHz, sampleRate);
        return {
            process(x) {
                return x - lp.process(x);
            },
            reset() { lp.reset(); },
        };
    }

    function makeAnalyser(ctx, smoothing) {
        const a = ctx.createAnalyser();
        a.fftSize = FFT_SIZE;
        a.smoothingTimeConstant = smoothing;
        a.minDecibels = -100;
        a.maxDecibels = -25;
        return a;
    }

    /**
     * @param {HTMLAudioElement} audioEl
     * @param {object} [opts]
     */
    function createAudioAnalyser(audioEl, opts) {
        const options = opts || {};
        let onFrame = typeof options.onFrame === 'function' ? options.onFrame : null;

        let sensitivity = Number.isFinite(options.sensitivity) ? options.sensitivity : 1.35;
        let refractoryMs = Number.isFinite(options.refractoryMs) ? options.refractoryMs : 160;
        let pulseDecayMs = Number.isFinite(options.pulseDecayMs) ? options.pulseDecayMs : 140;
        let inputGain = Number.isFinite(options.inputGain) ? options.inputGain : 1.0;
        let smoothing = Number.isFinite(options.smoothing)
            ? clamp(options.smoothing, 0, 0.95)
            : 0.2;
        let waveSource = isChannelId(options.waveSource) ? options.waveSource : 'full';

        /** @type {AudioContext|null} */
        let ctx = null;
        /** @type {MediaElementAudioSourceNode|null} */
        let source = null;
        /** @type {AnalyserNode|null} */
        let analyser = null;
        /** @type {AnalyserNode|null} */
        let analyserL = null;
        /** @type {AnalyserNode|null} */
        let analyserR = null;
        /** @type {boolean} */
        let stereoGraph = false;

        const timeData = new Float32Array(FFT_SIZE);
        const timeL = new Float32Array(FFT_SIZE);
        const timeR = new Float32Array(FFT_SIZE);
        const freqData = new Uint8Array(FFT_SIZE / 2);
        const freqL = new Uint8Array(FFT_SIZE / 2);
        const freqR = new Uint8Array(FFT_SIZE / 2);
        const prevMag = new Float32Array(FFT_SIZE / 2);
        let hasPrevMag = false;

        const waveOut = new Uint8Array(WAVE_BINS);
        const filterScratch = new Float32Array(FFT_SIZE);
        /** Precomputed center / vocal time buffers each frame */
        const centerBuf = new Float32Array(FFT_SIZE);
        const vocalBuf = new Float32Array(FFT_SIZE);

        let filters = null;
        let filtersSr = 0;
        let vocalBandFilter = null;

        const onsetHist = new Float32Array(ONSET_HIST);
        let onsetHistWrite = 0;
        let onsetHistCount = 0;

        let envelope = 0;
        let beat = 0;
        let osfPrev = 0;
        let osfPrev2 = 0;
        let bassPrev = 0;
        let rmsPrev = 0;
        let kickPrev = 0;

        let agcLevel = 0.25;
        let lastBeatAt = -1e9;
        let lastSampleWall = 0;
        let graphReady = false;
        let graphError = null;
        let lastThreshold = 0;
        /** 0..1 how stereo the current material is (for UI / fallbacks). */
        let stereoWidth = 0;

        function ensureFilters(sr) {
            if (filters && filtersSr === sr) return;
            filtersSr = sr;
            filters = {
                bass: makeLp(150, sr),
                lowmid: makeBand(150, 500, sr),
                mid: makeBand(500, 2000, sr),
                presence: makeBand(2000, 5000, sr),
                treble: makeHp(5000, sr),
            };
            // Vocal formant-ish band after center extract
            vocalBandFilter = makeBand(200, 4000, sr);
        }

        let stereoMute = null;
        let splitter = null;
        const tapOnly = !!options.tapOnly;

        function attachSource(srcNode) {
            if (!srcNode || !ctx) return;
            try {
                if (source && analyser) source.disconnect(analyser);
            } catch (_) { /* not connected */ }
            try {
                if (source && splitter) source.disconnect(splitter);
            } catch (_) { /* not connected */ }
            source = srcNode;
            if (analyser) source.connect(analyser);
            if (splitter) {
                try { source.connect(splitter); } catch (_) { /* ignore */ }
            }
        }

        function ensureGraph() {
            if (graphReady) return true;
            if (graphError) return false;
            try {
                const AC = root.AudioContext || root.webkitAudioContext;
                if (!AC) {
                    graphError = new Error('Web Audio API not available');
                    return false;
                }
                ctx = options.context || new AC();
                if (options.sourceNode) {
                    source = options.sourceNode;
                } else {
                    source = ctx.createMediaElementSource(audioEl);
                }

                analyser = makeAnalyser(ctx, smoothing);
                source.connect(analyser);
                if (!tapOnly && !options.context) {
                    analyser.connect(ctx.destination);
                }

                try {
                    splitter = ctx.createChannelSplitter(2);
                    source.connect(splitter);
                    analyserL = makeAnalyser(ctx, smoothing);
                    analyserR = makeAnalyser(ctx, smoothing);
                    splitter.connect(analyserL, 0);
                    splitter.connect(analyserR, 1);
                    stereoMute = ctx.createGain();
                    stereoMute.gain.value = 0;
                    analyserL.connect(stereoMute);
                    analyserR.connect(stereoMute);
                    stereoMute.connect(ctx.destination);
                    stereoGraph = true;
                } catch (e) {
                    console.warn('Stereo split unavailable; vocals fall back to band-pass', e);
                    analyserL = null;
                    analyserR = null;
                    stereoGraph = false;
                    splitter = null;
                }

                ensureFilters(ctx.sampleRate || 44100);
                graphReady = true;
                return true;
            } catch (e) {
                graphError = e;
                console.warn('Audio analysis graph failed:', e);
                return false;
            }
        }

        function retarget(srcNode) {
            if (!ensureGraph() || !srcNode) return false;
            attachSource(srcNode);
            return true;
        }

        async function resume() {
            if (!ensureGraph() || !ctx) return false;
            if (ctx.state === 'suspended') {
                try {
                    await ctx.resume();
                } catch (e) {
                    console.warn('AudioContext resume failed', e);
                    return false;
                }
            }
            return ctx.state === 'running';
        }

        function bandEnergy(freq, binHz, loHz, hiHz) {
            const nBins = freq.length;
            const i0 = Math.max(1, Math.floor(loHz / binHz));
            const i1 = Math.min(nBins - 1, Math.ceil(hiHz / binHz));
            if (i1 < i0) return 0;
            let sum = 0;
            for (let i = i0; i <= i1; i++) sum += freq[i];
            return sum / (i1 - i0 + 1);
        }

        /**
         * Spectral center energy in [lo,hi] Hz using L/R correlation.
         * Bins where L≈R (phase-agnostic magnitude) are treated as centered.
         */
        function centerBandEnergy(fL, fR, binHz, loHz, hiHz) {
            const nBins = fL.length;
            const i0 = Math.max(1, Math.floor(loHz / binHz));
            const i1 = Math.min(nBins - 1, Math.ceil(hiHz / binHz));
            if (i1 < i0) return 0;
            let sum = 0;
            let wsum = 0;
            for (let i = i0; i <= i1; i++) {
                const ml = fL[i] / 255;
                const mr = fR[i] / 255;
                const mid = 0.5 * (ml + mr);
                const side = 0.5 * Math.abs(ml - mr);
                // Soft center mask: high when mid dominates side
                const mask = (mid * mid) / (mid * mid + side * side + 1e-4);
                sum += mid * mask;
                wsum += 1;
            }
            return wsum > 0 ? (sum / wsum) : 0;
        }

        /**
         * Build mid / side / center-extracted / vocal-band signals from L+R.
         * center ≈ mid gated by mid vs side power (classic karaoke-inverse).
         */
        function buildCenterAndVocals() {
            let midE = 0;
            let sideE = 0;
            const n = timeData.length;

            if (stereoGraph && analyserL && analyserR) {
                analyserL.getFloatTimeDomainData(timeL);
                analyserR.getFloatTimeDomainData(timeR);
                analyserL.getByteFrequencyData(freqL);
                analyserR.getByteFrequencyData(freqR);

                for (let i = 0; i < n; i++) {
                    const l = timeL[i];
                    const r = timeR[i];
                    const mid = 0.5 * (l + r);
                    const side = 0.5 * (l - r);
                    midE += mid * mid;
                    sideE += side * side;
                    // Power-ratio center extract (suppresses hard-panned content)
                    const m2 = mid * mid;
                    const s2 = side * side;
                    const w = m2 / (m2 + s2 + 1e-8);
                    // Extra attenuation of residual side bleed
                    const center = mid * w * w;
                    centerBuf[i] = center;
                    timeData[i] = mid; // full-mix mid for general analysis
                }
            } else {
                // Mono path: center = full signal
                analyser.getFloatTimeDomainData(timeData);
                for (let i = 0; i < n; i++) {
                    centerBuf[i] = timeData[i];
                    midE += timeData[i] * timeData[i];
                }
                sideE = 0;
                freqL.fill(0);
                freqR.fill(0);
            }

            stereoWidth = clamp(Math.sqrt(sideE / (midE + sideE + 1e-12)), 0, 1);

            // Vocal path: center → vocal-range band-pass
            if (vocalBandFilter) {
                for (let i = 0; i < n; i++) {
                    vocalBuf[i] = vocalBandFilter.process(centerBuf[i]);
                }
            } else {
                vocalBuf.set(centerBuf);
            }
        }

        function downsampleWaveform(src, dst, gain) {
            const nSrc = src.length;
            const nDst = dst.length;
            const g = gain > 0 ? gain : 1;
            for (let i = 0; i < nDst; i++) {
                const a = Math.floor((i / nDst) * nSrc);
                const b = Math.max(a + 1, Math.floor(((i + 1) / nDst) * nSrc));
                let peakPos = 0;
                let peakNeg = 0;
                let sum = 0;
                let count = 0;
                for (let j = a; j < b; j++) {
                    const v = src[j] * g;
                    if (v > peakPos) peakPos = v;
                    if (v < peakNeg) peakNeg = v;
                    sum += v;
                    count++;
                }
                const mean = count > 0 ? sum / count : 0;
                const peak = peakPos > -peakNeg ? peakPos : peakNeg;
                const sample = mean * 0.45 + peak * 0.55;
                dst[i] = Math.round(clamp(sample * 0.5 + 0.5, 0, 1) * 255);
            }
        }

        function levelToWaveform(level, dst) {
            const amp = clamp(level, 0, 1);
            for (let i = 0; i < dst.length; i++) {
                const t = i / (dst.length - 1);
                const s = Math.sin(t * Math.PI * 2 * 3) * amp * 0.85;
                dst[i] = Math.round(clamp(s * 0.5 + 0.5, 0, 1) * 255);
            }
            if (amp > 0.2) {
                const c = (dst.length / 2) | 0;
                dst[c] = Math.round(clamp(0.5 + amp * 0.5, 0, 1) * 255);
            }
            if (amp < 0.02) dst.fill(128);
        }

        function rmsOf(buf) {
            let s = 0;
            for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
            return Math.sqrt(s / buf.length);
        }

        function fillWaveForSource(srcId, gain, channels) {
            const id = isChannelId(srcId) ? srcId : 'full';
            const meta = CHANNELS.find((c) => c.id === id);
            if (!meta || meta.kind === 'level') {
                levelToWaveform(channels[id] || 0, waveOut);
                return;
            }
            if (id === 'full') {
                downsampleWaveform(timeData, waveOut, gain);
                return;
            }
            if (id === 'center') {
                downsampleWaveform(centerBuf, waveOut, gain * 1.15);
                return;
            }
            if (id === 'vocals') {
                // Band-pass already attenuates — boost for scope readability
                downsampleWaveform(vocalBuf, waveOut, gain * 2.4);
                return;
            }
            if (!filters || !filters[id]) {
                downsampleWaveform(timeData, waveOut, gain);
                return;
            }
            const f = filters[id];
            for (let i = 0; i < timeData.length; i++) {
                filterScratch[i] = f.process(timeData[i]);
            }
            const boost = id === 'treble' ? 2.2 : id === 'bass' ? 1.3 : 1.8;
            downsampleWaveform(filterScratch, waveOut, gain * boost);
        }

        function pushOnsetHist(v) {
            onsetHist[onsetHistWrite] = v;
            onsetHistWrite = (onsetHistWrite + 1) % ONSET_HIST;
            if (onsetHistCount < ONSET_HIST) onsetHistCount += 1;
        }

        function onsetMeanStd() {
            const n = onsetHistCount;
            if (n < 4) return { mean: 0.02, std: 0.02 };
            let sum = 0;
            for (let i = 0; i < n; i++) sum += onsetHist[i];
            const mean = sum / n;
            let varSum = 0;
            for (let i = 0; i < n; i++) {
                const d = onsetHist[i] - mean;
                varSum += d * d;
            }
            return { mean, std: Math.sqrt(varSum / n) };
        }

        function computeOnsetStrength(freq, bassN, rmsN, binHz) {
            const nBins = freq.length;
            const kickHi = Math.min(nBins - 1, Math.max(2, Math.ceil(150 / binHz)));
            const lowHi = Math.min(nBins - 1, Math.max(kickHi + 1, Math.ceil(400 / binHz)));
            const midHi = Math.min(nBins - 1, Math.max(lowHi + 1, Math.ceil(2500 / binHz)));

            let fluxKick = 0;
            let fluxLow = 0;
            let fluxMid = 0;
            let wKick = 0;
            let wLow = 0;
            let wMid = 0;

            if (hasPrevMag) {
                for (let i = 1; i <= midHi; i++) {
                    const cur = Math.log1p(freq[i]);
                    const d = cur - prevMag[i];
                    if (d <= 0) continue;
                    if (i <= kickHi) {
                        fluxKick += d;
                        wKick += 1;
                    } else if (i <= lowHi) {
                        fluxLow += d;
                        wLow += 1;
                    } else {
                        fluxMid += d;
                        wMid += 1;
                    }
                }
            }
            for (let i = 0; i < nBins; i++) prevMag[i] = Math.log1p(freq[i]);
            hasPrevMag = true;

            const nKick = wKick > 0 ? fluxKick / wKick : 0;
            const nLow = wLow > 0 ? fluxLow / wLow : 0;
            const nMid = wMid > 0 ? fluxMid / wMid : 0;

            const bassDelta = Math.max(0, bassN - bassPrev);
            const rmsDelta = Math.max(0, rmsN - rmsPrev);
            bassPrev = bassN;
            rmsPrev = rmsN;

            const kickFluxRaw = nKick * 2.4 + bassDelta * 1.2;
            const spectral = nKick * 2.4 + nLow * 1.1 + nMid * 0.45;
            const temporal = bassDelta * 1.6 + rmsDelta * 0.9;
            return {
                osfRaw: spectral * 0.72 + temporal * 0.28,
                kickFluxRaw,
            };
        }

        function sample() {
            if (!ensureGraph() || !analyser) return null;

            const now = performance.now();
            const dt = lastSampleWall > 0
                ? Math.min(0.08, Math.max(0.001, (now - lastSampleWall) / 1000))
                : 1 / 50;
            lastSampleWall = now;

            const sr = ctx && ctx.sampleRate ? ctx.sampleRate : 44100;
            ensureFilters(sr);

            // Mid–side center + vocal extract (also fills timeData with mid)
            buildCenterAndVocals();
            analyser.getByteFrequencyData(freqData);

            let sumSq = 0;
            let peakAbs = 0;
            for (let i = 0; i < timeData.length; i++) {
                const v = timeData[i];
                const a = v < 0 ? -v : v;
                if (a > peakAbs) peakAbs = a;
                sumSq += v * v;
            }
            const rms = Math.sqrt(sumSq / timeData.length);

            const loud = Math.max(rms * 2.8, peakAbs * 1.4);
            if (loud > 0.015) {
                agcLevel += (loud - agcLevel) * Math.min(1, dt * 0.85);
            } else {
                agcLevel += (0.18 - agcLevel) * Math.min(1, dt * 0.12);
            }
            agcLevel = clamp(agcLevel, 0.05, 0.95);
            const agc = (0.35 / agcLevel) * clamp(inputGain, 0.25, 4);

            const rmsN = clamp(rms * agc * 1.15, 0, 1);
            const peakN = clamp(peakAbs * agc, 0, 1);
            const binHz = sr / analyser.fftSize;

            const eBass = bandEnergy(freqData, binHz, 20, 150) / 200;
            const eLowmid = bandEnergy(freqData, binHz, 150, 500) / 180;
            const eMid = bandEnergy(freqData, binHz, 500, 2000) / 160;
            const ePresence = bandEnergy(freqData, binHz, 2000, 5000) / 140;
            const eTreble = bandEnergy(freqData, binHz, 5000, 16000) / 120;

            // Center / vocal levels from extracted time signals + spectral mask
            const centerRms = rmsOf(centerBuf);
            const vocalRms = rmsOf(vocalBuf);
            let eCenter = centerRms * 3.2;
            let eVocals = vocalRms * 4.5;

            if (stereoGraph && stereoWidth > 0.05) {
                // Spectral center in vocal band reinforces time-domain extract
                const specVox = centerBandEnergy(freqL, freqR, binHz, 200, 4000);
                const specCenter = centerBandEnergy(freqL, freqR, binHz, 80, 8000);
                eVocals = Math.max(eVocals, specVox * 1.8);
                eCenter = Math.max(eCenter, specCenter * 1.5);
            }

            const gainMix = agc * 0.35 + 0.65;
            const bass = clamp(eBass * gainMix, 0, 1);
            const lowmid = clamp(eLowmid * gainMix, 0, 1);
            const mid = clamp(eMid * gainMix, 0, 1);
            const presence = clamp(ePresence * gainMix, 0, 1);
            const treble = clamp(eTreble * gainMix, 0, 1);
            const center = clamp(eCenter * gainMix, 0, 1);
            const vocals = clamp(eVocals * gainMix, 0, 1);
            const full = clamp(Math.max(rmsN, peakN * 0.7), 0, 1);

            const { osfRaw, kickFluxRaw } = computeOnsetStrength(freqData, bass, rmsN, binHz);
            const osf = clamp(1 - Math.exp(-osfRaw * 1.15), 0, 1);
            const kickFlux = clamp(1 - Math.exp(-kickFluxRaw * 1.2), 0, 1);
            const kickDelta = Math.max(0, kickFlux - kickPrev);
            kickPrev = kickFlux;
            const kick = clamp(Math.max(kickFlux * 0.55, kickDelta * 2.2), 0, 1);

            pushOnsetHist(osf);
            const { mean, std } = onsetMeanStd();
            const sens = clamp(sensitivity, 0.5, 3);
            const k = 3.15 - sens * 1.05;
            const thr = mean + Math.max(std, 0.012) * k + 0.018;
            lastThreshold = thr;

            const isLocalMax = osfPrev >= osfPrev2 && osfPrev >= osf;
            const aboveThr = osfPrev > thr;
            const activeEnough = osfPrev > Math.max(0.04, mean * 0.55);
            const refractoryOk = (now - lastBeatAt) >= refractoryMs;
            const crossing = osfPrev2 <= thr && osfPrev > thr && osfPrev > osfPrev2;

            if (
                refractoryOk
                && activeEnough
                && ((isLocalMax && aboveThr) || (crossing && osfPrev > thr * 0.92))
            ) {
                const over = (osfPrev - thr) / Math.max(0.04, thr);
                beat = clamp(0.5 + over * 0.9 + osfPrev * 0.45, 0.45, 1);
                lastBeatAt = now;
            } else {
                const decay = Math.exp(-dt * (1000 / Math.max(40, pulseDecayMs)));
                beat *= decay;
                if (beat < 0.015) beat = 0;
            }

            osfPrev2 = osfPrev;
            osfPrev = osf;

            const envTarget = clamp(
                Math.max(rmsN, bass * 0.9, peakN * 0.55, osf * 0.65),
                0,
                1,
            );
            const attack = 1 - Math.exp(-dt * 28);
            const release = 1 - Math.exp(-dt * 5);
            if (envTarget > envelope) envelope += (envTarget - envelope) * attack;
            else envelope += (envTarget - envelope) * release;
            envelope = clamp(envelope, 0, 1);

            const channels = {
                full,
                bass,
                lowmid,
                mid,
                presence,
                treble,
                center,
                vocals,
                rms: rmsN,
                peak: peakN,
                envelope,
                onset: osf,
                kick,
                beat,
            };

            fillWaveForSource(waveSource, agc, channels);

            const frame = {
                t: audioEl.currentTime || 0,
                playing: !audioEl.paused && !audioEl.ended,
                rms: rmsN,
                bass,
                mid,
                envelope,
                beat,
                flux: osf,
                peak: peakN,
                onset: osf,
                kick,
                lowmid,
                presence,
                treble,
                vocals,
                center,
                full,
                channels,
                waveform: waveOut,
                waveSource,
                frequency: freqData,
                threshold: lastThreshold,
                agc: agcLevel,
                stereoWidth,
                stereoGraph,
            };

            if (onFrame) {
                try { onFrame(frame); } catch (e) { /* ignore */ }
            }
            return frame;
        }

        function resetDetectors() {
            envelope = 0;
            beat = 0;
            osfPrev = 0;
            osfPrev2 = 0;
            bassPrev = 0;
            rmsPrev = 0;
            kickPrev = 0;
            agcLevel = 0.25;
            lastBeatAt = -1e9;
            hasPrevMag = false;
            prevMag.fill(0);
            onsetHist.fill(0);
            onsetHistWrite = 0;
            onsetHistCount = 0;
            lastThreshold = 0;
            waveOut.fill(128);
            lastSampleWall = 0;
            stereoWidth = 0;
            if (filters) {
                for (const k of Object.keys(filters)) filters[k].reset();
            }
            if (vocalBandFilter) vocalBandFilter.reset();
        }

        function setOnFrame(fn) {
            onFrame = typeof fn === 'function' ? fn : null;
        }
        function setSensitivity(v) {
            if (Number.isFinite(v)) sensitivity = clamp(v, 0.5, 3);
        }
        function setInputGain(v) {
            if (Number.isFinite(v)) inputGain = clamp(v, 0.25, 4);
        }
        function setRefractoryMs(v) {
            if (Number.isFinite(v)) refractoryMs = clamp(v, 60, 600);
        }
        function setPulseDecayMs(v) {
            if (Number.isFinite(v)) pulseDecayMs = clamp(v, 40, 800);
        }
        function setSmoothing(v) {
            if (!Number.isFinite(v)) return;
            smoothing = clamp(v, 0, 0.95);
            if (analyser) analyser.smoothingTimeConstant = smoothing;
            if (analyserL) analyserL.smoothingTimeConstant = smoothing;
            if (analyserR) analyserR.smoothingTimeConstant = smoothing;
        }
        function setWaveSource(id) {
            if (isChannelId(id)) waveSource = id;
        }
        function getWaveSource() {
            return waveSource;
        }

        function getConfig() {
            return {
                sensitivity,
                inputGain,
                refractoryMs,
                pulseDecayMs,
                smoothing,
                waveSource,
                stereoGraph,
            };
        }

        return {
            WAVE_BINS,
            ensureGraph,
            resume,
            sample,
            resetDetectors,
            setOnFrame,
            setSensitivity,
            setInputGain,
            setRefractoryMs,
            setPulseDecayMs,
            setSmoothing,
            setWaveSource,
            getWaveSource,
            getConfig,
            getError: () => graphError,
            isReady: () => graphReady,
            getContext: () => ctx,
            retarget,
            getSource: () => source,
        };
    }

    /**
     * One AudioContext, two media-element sources, deck gains + mixGain.
     * Lead analyser taps the incoming MES (track switch). Mix analyser taps
     * mixGain so viz can follow the audible blend during a fade.
     */
    function createDeckMixer(audioA, audioB, analyserOpts) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) throw new Error('Web Audio API not available');
        const ctx = new AC();
        const mesA = ctx.createMediaElementSource(audioA);
        let mesB = null;
        try {
            mesB = ctx.createMediaElementSource(audioB);
        } catch (e) {
            console.warn('Second MediaElementSource failed; cut-only one deck', e);
        }
        const gainA = ctx.createGain();
        const gainB = ctx.createGain();
        const mixGain = ctx.createGain();
        mesA.connect(gainA);
        if (mesB) mesB.connect(gainB);
        gainA.connect(mixGain);
        gainB.connect(mixGain);
        mixGain.connect(ctx.destination);
        gainA.gain.value = 1;
        gainB.gain.value = 0;
        mixGain.gain.value = 1;
        audioA.volume = 1;
        if (audioB) audioB.volume = 1;

        const analyser = createAudioAnalyser(audioA, Object.assign({}, analyserOpts || {}, {
            context: ctx,
            sourceNode: mesA,
            tapOnly: true,
        }));
        analyser.ensureGraph();

        const mixAnalyser = createAudioAnalyser(audioA, Object.assign({}, analyserOpts || {}, {
            context: ctx,
            sourceNode: mixGain,
            tapOnly: true,
        }));
        mixAnalyser.ensureGraph();

        return {
            ctx,
            mesA,
            mesB,
            gainA,
            gainB,
            mixGain,
            analyser,
            mixAnalyser,
            dual: !!mesB,
        };
    }

    function channelValue(frame, id) {
        if (!frame) return 0;
        if (frame.channels && Number.isFinite(frame.channels[id])) {
            return clamp(frame.channels[id], 0, 1);
        }
        if (Number.isFinite(frame[id])) return clamp(frame[id], 0, 1);
        return 0;
    }

    const api = {
        WAVE_BINS,
        FFT_SIZE,
        CHANNELS,
        CHANNEL_IDS,
        isChannelId,
        channelValue,
        createAudioAnalyser,
        createDeckMixer,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.AudioAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
