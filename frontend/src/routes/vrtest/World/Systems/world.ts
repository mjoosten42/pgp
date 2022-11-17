import { Ammo } from "./ammo";
import * as THREE from "three";
import type { Entity } from "./entity";

export class World {
	scene: THREE.Scene;
	world: Ammo.btDiscreteDynamicsWorld;
	renderer: THREE.WebGLRenderer;
	camera: THREE.PerspectiveCamera;
	container: Element;
	clientWidth: number = 0;
	clientHeight: number = 0;
	entities: Entity[] = [];

	constructor(container: Element) {
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color("skyblue");

		const collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
		const collisionDispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
		const broadphase = new Ammo.btDbvtBroadphase();
		const constraintSolver = new Ammo.btSequentialImpulseConstraintSolver();
		this.world = new Ammo.btDiscreteDynamicsWorld(collisionDispatcher, broadphase, constraintSolver, collisionConfiguration);
		// this.world.debugDrawWorld();
		this.world.setGravity(new Ammo.btVector3(0, -9.81, 0));
	
		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.physicallyCorrectLights = true;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		this.renderer.xr.enabled = true;
		
		const cameraFov = 90;
		const cameraAspect = 1;
		const cameraNear = 0.1;
		const cameraFar = 1000;
		this.camera = new THREE.PerspectiveCamera(cameraFov, cameraAspect, cameraNear, cameraFar);
		this.camera.position.set(0, 1.8, 0);

		this.container = container;
	}

	private resize() {
		if (this.clientWidth !== this.container.clientWidth || this.clientHeight != this.container.clientHeight) {
			this.clientWidth = this.container.clientWidth;
			this.clientHeight = this.container.clientHeight;
			this.camera.aspect = this.clientWidth / this.clientHeight;
			this.camera.updateProjectionMatrix();
			this.renderer.setSize(this.clientWidth, this.clientHeight);
			this.renderer.setPixelRatio(window.devicePixelRatio);
		}
	}

	add(entity: Entity) {
		this.entities.push(entity);
		this.scene.add(entity.renderObject);
		this.world.addRigidBody(entity.physicsObject);
	}

	start(steps: number = 300) {
		let previousTime: number;
		let stepIndex: number = 0;

		this.renderer.setAnimationLoop((currentTime) => {
			if (previousTime !== undefined) {
				while (previousTime < currentTime) {
					if (stepIndex % 2 == 0) {
						for (let entity of this.entities) {
							entity.tick();
						}
					}

					this.world.stepSimulation(1 / steps, 1, 1 / steps);
					previousTime += 1000 / steps;
					stepIndex += 1;
				}
			}

			for (let entity of this.entities) {
				entity.update();
			}

			this.resize();
			this.renderer.render(this.scene, this.camera);
			previousTime = currentTime;
		});
	}

	stop() {
		console.log("stopping animation loop");
		this.renderer.setAnimationLoop(null);
	}
}
