export function mountParticles(canvas, getState = () => ({ mode: 'idle', immersive: false })) {
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const particles = Array.from({ length: 980 }, (_, index) => ({
        index,
        radius: 96 + Math.random() * 430,
        angle: Math.random() * Math.PI * 2,
        speed: 0.00045 + Math.random() * 0.0018,
        size: 0.55 + Math.random() * 1.35,
        depth: Math.random(),
    }));

    let started = performance.now();
    let frameId = 0;

    function draw(now) {
        const { mode, immersive } = getState() || {};
        const time = reducedMotion ? 1000 : now - started;
        const width = canvas.width = canvas.clientWidth || canvas.width;
        const height = canvas.height = canvas.clientHeight || canvas.height;
        const center = width / 2;
        const fieldScale = immersive ? 1.28 : 0.92;
        const intensity = {
            idle: 0.68,
            listening: 1.05,
            thinking: 0.85,
            speaking: 1.18,
            executing: 0.98,
        }[mode] || 0.9;
        const contraction = (mode === 'thinking' ? 0.72 : mode === 'listening' ? 1.12 : 1) * fieldScale;
        const pulse =
            mode === 'speaking'
                ? Math.sin(time / 110) * 9
                : mode === 'listening'
                    ? Math.sin(time / 420) * 16
                    : Math.sin(time / 900) * 8;

        context.clearRect(0, 0, width, height);

        const glow = context.createRadialGradient(center, center, 20, center, center, 470);
        glow.addColorStop(0, `rgba(0, 232, 226, ${0.22 * intensity})`);
        glow.addColorStop(0.34, `rgba(0, 128, 150, ${0.15 * intensity})`);
        glow.addColorStop(1, 'rgba(5, 7, 13, 0)');
        context.fillStyle = glow;
        context.beginPath();
        context.arc(center, center, 460 + pulse, 0, Math.PI * 2);
        context.fill();

        context.save();
        context.translate(center, center);
        context.rotate(mode === 'thinking' ? time / 2800 : time / 9000);

        particles.forEach((particle, index) => {
            const stateSpeed = mode === 'thinking' ? 2.2 : mode === 'executing' ? 0.72 : 1;
            const angle = particle.angle + time * particle.speed * stateSpeed;
            const spiral = mode === 'thinking' ? Math.sin(time / 650 + index) * 24 : 0;
            const radius = (particle.radius + spiral + pulse * particle.depth) * contraction;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle * 1.18) * radius * 0.72;
            const alpha = 0.26 + particle.depth * 0.6;

            if (index % 5 === 0) {
                const next = particles[(index + 9) % particles.length];
                const nextAngle = next.angle + time * next.speed * stateSpeed;
                const nextRadius = next.radius * contraction;
                const nx = Math.cos(nextAngle) * nextRadius;
                const ny = Math.sin(nextAngle * 1.18) * nextRadius * 0.72;
                const distance = Math.hypot(x - nx, y - ny);
                if (distance < 96) {
                    context.strokeStyle = `rgba(0, 239, 229, ${0.035 * intensity})`;
                    context.lineWidth = 1;
                    context.beginPath();
                    context.moveTo(x, y);
                    context.lineTo(nx, ny);
                    context.stroke();
                }
            }

            context.fillStyle = `rgba(0, 238, 230, ${alpha * intensity})`;
            context.beginPath();
            context.arc(x, y, particle.size * intensity, 0, Math.PI * 2);
            context.fill();
        });

        context.strokeStyle = `rgba(0, 239, 229, ${0.22 * intensity})`;
        context.lineWidth = mode === 'executing' ? 2.4 : 1.4;
        for (let ring = 0; ring < 3; ring += 1) {
            context.beginPath();
            context.ellipse(0, 0, 96 + ring * 58 + pulse, 74 + ring * 38, ring * 0.62, 0, Math.PI * 2);
            context.stroke();
        }

        context.fillStyle = `rgba(184, 255, 251, ${0.68 * intensity})`;
        context.beginPath();
        context.arc(0, 0, 18 + pulse * 0.18, 0, Math.PI * 2);
        context.fill();
        context.restore();

        if (!reducedMotion) frameId = requestAnimationFrame(draw);
    }

    frameId = requestAnimationFrame(draw);

    return {
        stop() {
            if (frameId) cancelAnimationFrame(frameId);
        },
    };
}
