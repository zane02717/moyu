import { useEffect, useRef } from 'react';
import * as THREE from 'three';

function roundedRectShape(width: number, height: number, radius: number) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

export function AuthScene() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const hostElement = hostRef.current;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.45, 8.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setClearColor(0xffffff, 0);
    hostElement.appendChild(renderer.domElement);

    const root = new THREE.Group();
    root.rotation.x = -0.24;
    root.rotation.y = -0.2;
    scene.add(root);

    const ambient = new THREE.AmbientLight(0xffffff, 2.2);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(-3.2, 4.5, 6);
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x6fbf9a, 7, 12);
    fillLight.position.set(3.4, -1.2, 4);
    scene.add(fillLight);

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf8fffb,
      roughness: 0.18,
      metalness: 0.02,
      transmission: 0.38,
      thickness: 0.35,
      transparent: true,
      opacity: 0.82,
      clearcoat: 0.85,
      clearcoatRoughness: 0.18
    });
    const greenMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x9ad5ad,
      roughness: 0.24,
      metalness: 0.02,
      transparent: true,
      opacity: 0.92,
      clearcoat: 0.65
    });
    const redMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xff745f,
      roughness: 0.26,
      metalness: 0.02,
      transparent: true,
      opacity: 0.92,
      clearcoat: 0.6
    });
    const goldMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf5d84e,
      roughness: 0.24,
      metalness: 0.02,
      transparent: true,
      opacity: 0.9,
      clearcoat: 0.7
    });
    const blueMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x78b8ec,
      roughness: 0.22,
      metalness: 0.02,
      transparent: true,
      opacity: 0.88,
      clearcoat: 0.7
    });
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x9eb0a6, transparent: true, opacity: 0.52 });

    const boardGeometry = new THREE.ExtrudeGeometry(roundedRectShape(5.2, 3.25, 0.18), {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.035,
      bevelSegments: 6
    });
    boardGeometry.center();
    const board = new THREE.Mesh(boardGeometry, glassMaterial);
    root.add(board);

    const grid = new THREE.Group();
    for (let index = 0; index <= 8; index += 1) {
      const x = -2.4 + index * 0.6;
      const points = [new THREE.Vector3(x, -1.45, 0.08), new THREE.Vector3(x, 1.45, 0.08)];
      grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial));
    }
    for (let index = 0; index <= 6; index += 1) {
      const y = -1.35 + index * 0.45;
      const points = [new THREE.Vector3(-2.45, y, 0.08), new THREE.Vector3(2.45, y, 0.08)];
      grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial));
    }
    root.add(grid);

    const chipGeometry = new THREE.ExtrudeGeometry(roundedRectShape(0.74, 0.46, 0.08), {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelSegments: 5
    });
    chipGeometry.center();
    const chipSpecs: Array<[number, number, THREE.Material, number]> = [
      [-1.75, 0.9, goldMaterial, -0.04],
      [-0.72, 0.18, greenMaterial, 0.08],
      [0.98, 0.72, redMaterial, -0.08],
      [1.48, -0.68, blueMaterial, 0.05],
      [-1.15, -0.96, greenMaterial, 0.12]
    ];
    const chips = chipSpecs.map(([x, y, material, rot]) => {
      const chip = new THREE.Mesh(chipGeometry, material);
      chip.position.set(x, y, 0.24);
      chip.rotation.z = rot;
      root.add(chip);
      return chip;
    });

    const ringGeometry = new THREE.TorusGeometry(2.95, 0.006, 6, 180);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x86b99a, transparent: true, opacity: 0.42 });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2.4;
    ring.position.z = -0.26;
    scene.add(ring);

    const particlesGeometry = new THREE.BufferGeometry();
    const particles = new Float32Array(96 * 3);
    for (let i = 0; i < 96; i += 1) {
      particles[i * 3] = (Math.random() - 0.5) * 8.6;
      particles[i * 3 + 1] = (Math.random() - 0.5) * 4.7;
      particles[i * 3 + 2] = (Math.random() - 0.5) * 3.8;
    }
    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(particles, 3));
    const particlesMesh = new THREE.Points(
      particlesGeometry,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.55 })
    );
    scene.add(particlesMesh);

    function resize() {
      const rect = hostElement.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    let frame = 0;
    let raf = 0;
    function animate() {
      frame += 0.01;
      root.rotation.y = -0.22 + Math.sin(frame * 0.72) * 0.11;
      root.rotation.x = -0.22 + Math.cos(frame * 0.58) * 0.045;
      ring.rotation.z += 0.0022;
      particlesMesh.rotation.y -= 0.0009;
      chips.forEach((chip, index) => {
        chip.position.z = 0.22 + Math.sin(frame * 1.35 + index) * 0.045;
      });
      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(animate);
    }
    animate();

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      hostElement.removeChild(renderer.domElement);
      boardGeometry.dispose();
      chipGeometry.dispose();
      particlesGeometry.dispose();
      glassMaterial.dispose();
      greenMaterial.dispose();
      redMaterial.dispose();
      goldMaterial.dispose();
      blueMaterial.dispose();
      lineMaterial.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return <div className="auth-3d-scene" ref={hostRef} aria-hidden="true" />;
}
