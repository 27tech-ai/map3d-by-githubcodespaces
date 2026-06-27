import { useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useAreaStore } from "@/state/areaStore";
import { Html, Sky, Environment, ContactShadows, OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";
import { useActionStore } from "@/state/exportStore";
import { GLTFExporter } from "three/examples/jsm/Addons.js";
import Car from "./Car";
import instanceFleet from "@/api/axios";

const scale = 51000;

const highwayWidths: Record<string, number> = {
  motorway: 16,
  trunk: 14,
  primary: 12,
  secondary: 9,
  tertiary: 7,
  residential: 6,
  service: 5,
  footway: 3,
  path: 2.5,
};

const highwayColors: Record<string, string> = {
  motorway: "#5b7fff",
  trunk: "#4a6cff",
  primary: "#3b5bd0",
  secondary: "#3f8f44",
  tertiary: "#5c7c55",
  residential: "#6d6d6d",
  service: "#7b7b7b",
  footway: "#8c8c8c",
  path: "#9f9f9f",
};

function getRoadWidth(tags: any) {
  if (tags.width) {
    const parsed = parseFloat(String(tags.width).replace(/[a-zA-Z]/g, ""));
    if (!isNaN(parsed)) return Math.max(2, Math.min(parsed, 30));
  }
  if (tags.lanes) {
    const parsed = parseInt(String(tags.lanes), 10);
    if (!isNaN(parsed)) return Math.max(3, Math.min(parsed * 2.5, 30));
  }
  return highwayWidths[tags.highway] || 5;
}

function getRoadColor(tags: any) {
  return highwayColors[tags.highway] || "#5c5f6c";
}

const overpassEndpoints = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

async function fetchOverpass(query: string) {
  let lastError: any;
  for (const endpoint of overpassEndpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: query,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!response.ok) {
        throw new Error(`Overpass ${endpoint} returned ${response.status}`);
      }
      const data = await response.json();
      if (data?.elements) return data;
      throw new Error("Unexpected Overpass response");
    } catch (error) {
      lastError = error;
      console.warn("Overpass fetch failed", endpoint, error);
    }
  }
  throw lastError;
}

function createOffsetPolygon(points: THREE.Vector2[], halfWidth: number) {
  if (points.length < 2) return null;
  const left: THREE.Vector2[] = [];
  const right: THREE.Vector2[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const prev = points[i - 1] || points[i];
    const next = points[i + 1] || points[i];
    const direction = next.clone().sub(prev).normalize();
    const perpendicular = new THREE.Vector2(-direction.y, direction.x).multiplyScalar(halfWidth);
    left.push(points[i].clone().add(perpendicular));
    right.push(points[i].clone().sub(perpendicular));
  }

  const polygon = [...left, ...right.reverse()];
  const shape = new THREE.Shape(polygon);
  return shape;
}

function Building({
  shape,
  extrudeSettings,
  tags,
}: {
  shape: THREE.Shape;
  extrudeSettings: any;
  tags: any;
}) {
  const [hovered, setHovered] = useState(false);
  const [clicked, setClicked] = useState(false);
  const [hoverPos, setHoverPos] = useState<THREE.Vector3 | null>(null);
  const [showTranslations, setShowTranslations] = useState(false);
  const [showAdditionalInfo, setShowAdditionalInfo] = useState(false);
  return (
    <mesh
      castShadow
      receiveShadow
      onPointerOver={(e) => {
        setHovered(true);
        e.stopPropagation();
      }}
      onPointerOut={(e) => {
        setHovered(false);
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        setHoverPos(e.point.clone());
        e.stopPropagation();
      }}
      onClick={(e) => {
        setClicked(!clicked);
        e.stopPropagation();
      }}
      rotation={[-Math.PI / 2, 0, 0]}
      userData={{ exportToGLB: true }}
    >
      <extrudeGeometry args={[shape, extrudeSettings]} />
      <meshStandardMaterial color={hovered || clicked ? "#007bff" : "#9da0a3"} />
      {(hovered || clicked) && hoverPos && (
        <Html position={[hoverPos.x, hoverPos.y + extrudeSettings.depth + 0.5, hoverPos.z]} center>
          <div
            role="dialog"
            aria-label={tags.name || "Building Information"}
            style={{
              color: "#000000",
              backgroundColor: "#ffffff96",
              backdropFilter: "blur(8px)",
              border: "none",
              padding: "14px",
              borderRadius: "10px",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontSize: "13px",
              width: "200px",
              boxShadow: "0 2px 14px rgba(0, 0, 0, 0.16)",
              transition: "all 0.2s ease-in-out",
            }}
          >
            <div
              style={{
                fontWeight: "600",
                fontSize: "15px",
                borderBottom: tags.name ? "1px solid rgba(0, 0, 0, 0.08)" : "none",
                paddingBottom: tags.name ? "6px" : "0",
                marginBottom: tags.name ? "8px" : "4px",
              }}
            >
              {tags.name || "Building Information"}
            </div>
            {["building", "height", "building:levels", "amenity", "denomination"].map(
              (key) =>
                tags[key] &&
                (key !== "building" || tags[key] !== "yes") && (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      margin: "4px 0",
                    }}
                  >
                    <span style={{ fontWeight: "500", color: "#5f6368" }}>
                      {key === "building"
                        ? "Type"
                        : key === "height"
                        ? "Height"
                        : key === "building:levels"
                        ? "Levels"
                        : key === "amenity"
                        ? "Facility"
                        : key === "denomination"
                        ? "Denomination"
                        : key.replace(/_/g, " ")}
                      :
                    </span>
                    <span style={{ textTransform: "capitalize" }}>
                      {key === "height" ? `${tags[key]} m` : tags[key]}
                    </span>
                  </div>
                )
            )}
            {[
              "addr:street",
              "addr:housenumber",
              "addr:district",
              "addr:city",
              "addr:postcode",
            ].some((key) => tags[key]) && (
              <div
                style={{
                  margin: "10px 0 8px",
                  borderTop: "1px solid rgba(0, 0, 0, 0.08)",
                  paddingTop: "8px",
                }}
              >
                <div style={{ fontWeight: "500", marginBottom: "4px", color: "#5f6368" }}>
                  Address
                </div>
                <div style={{ marginLeft: "4px", fontSize: "12px", color: "#5f6368" }}>
                  {[
                    [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "),
                    tags["addr:district"],
                    tags["addr:city"],
                    tags["addr:postcode"],
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </div>
              </div>
            )}
            {Object.entries(tags).filter(
              ([key]) =>
                ![
                  "building",
                  "name",
                  "height",
                  "building:levels",
                  "source",
                  "amenity",
                  "denomination",
                ].includes(key) &&
                !key.startsWith("addr:") &&
                !key.startsWith("name:") &&
                !key.startsWith("alt_name:")
            ).length > 0 && (
              <div
                style={{
                  margin: "10px 0 4px",
                  borderTop: "1px solid rgba(0, 0, 0, 0.08)",
                  paddingTop: "8px",
                }}
              >
                <div
                  style={{
                    fontWeight: "500",
                    marginBottom: "4px",
                    color: "#5f6368",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                  onClick={() => setShowAdditionalInfo(!showAdditionalInfo)}
                >
                  Additional Information
                  <span>{showAdditionalInfo ? "▲" : "▼"}</span>
                </div>
                {showAdditionalInfo && (
                  <div>
                    {Object.entries(tags)
                      .filter(
                        ([key]) =>
                          ![
                            "building",
                            "name",
                            "height",
                            "building:levels",
                            "source",
                            "amenity",
                            "denomination",
                          ].includes(key) &&
                          !key.startsWith("addr:") &&
                          !key.startsWith("name:") &&
                          !key.startsWith("alt_name:")
                      )
                      .map(([key, value]) => {
                        if (
                          key === "description" ||
                          (typeof value === "string" && value.length > 80)
                        ) {
                          return (
                            <div key={key} style={{ margin: "8px 0" }}>
                              <div
                                style={{ fontWeight: "500", color: "#5f6368", marginBottom: "4px" }}
                              >
                                {key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ")}
                              </div>
                              <div
                                style={{
                                  textAlign: "left",
                                  fontSize: "12px",
                                  color: "#5f6368",
                                  fontWeight: "400",
                                  textWrap: "wrap",
                                  whiteSpace: "pre-wrap",
                                  lineHeight: "1.4",
                                  backgroundColor: "rgba(0,0,0,0.02)",
                                  padding: "6px 8px",
                                  borderRadius: "4px",
                                }}
                              >
                                {String(value)}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={key}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              margin: "4px 0",
                            }}
                          >
                            <span
                              style={{
                                fontWeight: "700",
                                color: "#5f6368",
                                textAlign: "left",
                              }}
                            >
                              {key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ")}:
                            </span>
                            <span
                              style={{
                                textTransform: "capitalize",
                                fontWeight: "400",
                                textAlign: "right",
                              }}
                            >
                              {String(value)}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
            {Object.entries(tags).filter(([key]) => key.startsWith("name:")).length > 0 && (
              <div
                style={{
                  margin: "10px 0 4px",
                  borderTop: "1px solid rgba(0, 0, 0, 0.08)",
                  paddingTop: "8px",
                  textAlign: "right",
                }}
              >
                <div
                  style={{
                    fontWeight: "500",
                    marginBottom: "4px",
                    color: "#5f6368",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                  onClick={() => setShowTranslations(!showTranslations)}
                >
                  Name Translations
                  <span>{showTranslations ? "▲" : "▼"}</span>
                </div>
                {showTranslations && (
                  <div>
                    {Object.entries(tags)
                      .filter(([key]) => key.startsWith("name:"))
                      .map(([key, value]) => (
                        <div
                          key={key}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            margin: "4px 0",
                          }}
                        >
                          <span style={{ fontWeight: "500", color: "#5f6368" }}>
                            {key.replace("name:", "").toUpperCase()}:
                          </span>
                          <span style={{ textTransform: "capitalize" }}>{String(value)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Html>
      )}
    </mesh>
  );
}

function Roads({ area, onCounts }: { area: any; onCounts?: (roadCount: number, treeCount: number) => void }) {
  const [roads, setRoads] = useState<any[]>([]);
  const [trees, setTrees] = useState<any[]>([]);

  if (!area || area.length < 2) return null;
  const refLat = (area[1].lat + area[0].lat) / 2;
  const refLng = (area[1].lng + area[0].lng) / 2;

  function project(lat: number, lng: number) {
    const x = (lng - refLng) * scale * Math.cos((refLat * Math.PI) / 180);
    const y = (lat - refLat) * scale;
    return new THREE.Vector2(x, y);
  }

  useEffect(() => {
    const south = area[1].lat;
    const west = area[1].lng;
    const north = area[0].lat;
    const east = area[0].lng;
    const roadQuery = `[out:json][timeout:25];(way["highway"](${south},${west},${north},${east}););out body geom;`;
    const treeQuery = `[out:json][timeout:25];(node["natural"="tree"](${south},${west},${north},${east});way["natural"="tree"](${south},${west},${north},${east}););out body geom;`;

    Promise.all([
      fetchOverpass(roadQuery),
      fetchOverpass(treeQuery),
    ])
      .then(([roadData, treeData]) => {
        const roadElements = roadData.elements || [];
        const treeElements = treeData.elements || [];
        setRoads(roadElements);
        setTrees(treeElements);
        if (onCounts) {
          onCounts(roadElements.length, treeElements.length);
        }
      })
      .catch((err) => console.error(err));
  }, [area]);

  const roadMeshes = useMemo(
    () =>
      roads
        .map((road) => {
          if (!road.geometry || road.geometry.length < 2) return null;
          const points = road.geometry
            .map((pt: any) => project(pt.lat, pt.lon))
            .map((v: THREE.Vector2) => new THREE.Vector3(v.x, 0.05, -v.y));
          const width = getRoadWidth(road.tags || {});
          const shape = createOffsetPolygon(
            road.geometry.map((pt: any) => project(pt.lat, pt.lon)),
            width / 2
          );
          if (!shape) return null;
          return {
            shape,
            color: getRoadColor(road.tags || {}),
            id: road.id,
          };
        })
        .filter(Boolean),
    [roads]
  );

  const treeInstances = useMemo(
    () =>
      trees
        .filter((tree) => tree.geometry && tree.geometry.length)
        .slice(0, 200)
        .map((tree, index) => {
          const point = tree.geometry[0];
          const v = project(point.lat, point.lon);
          return {
            position: [v.x, 0, -v.y] as [number, number, number],
            scale: 0.8 + Math.random() * 1.2,
            color: "#2a7d2a",
            key: `${tree.id}-${index}`,
          };
        }),
    [trees]
  );

  return (
    <group>
      {roadMeshes.length === 0 && (
        <Line
          points={[[0, 0, 0], [1, 0, 0]]}
          color="#ff0000"
          lineWidth={2}
        />
      )}
      {roadMeshes.map((road) => (
        <mesh key={road.id} castShadow receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} userData={{ exportToGLB: true }}>
          <extrudeGeometry args={[road.shape, { depth: 0.02, bevelEnabled: false }]} />
          <meshStandardMaterial color={road.color} roughness={0.8} metalness={0.1} />
        </mesh>
      ))}

      {treeInstances.map((tree) => (
        <group key={tree.key} position={tree.position} scale={tree.scale * 1.2}>
          <mesh castShadow receiveShadow userData={{ exportToGLB: true }} position={[0, 0.5, 0]}>
            <coneGeometry args={[0.3, 1.1, 8]} />
            <meshStandardMaterial color={tree.color} roughness={0.9} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, 0.1, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.3, 8]} />
            <meshStandardMaterial color="#4e342e" roughness={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Export() {
  const { scene } = useThree();
  const action = useActionStore((state) => state.action);
  const fleetSpaceId = useActionStore((state) => state.fleetSpaceId);

  const exportType = useActionStore((state) => state.exportType);

  const setAction = useActionStore((state) => state.setAction);

  useEffect(() => {
    if (action === true) {
      setAction(false);
      exportGLB();
    }
  }, [action, setAction, scene]);

  const uploadFleet = async (blob) => {
    const formData = new FormData();

    formData.append("object", blob, "box3d.glb");
    formData.append("title", "New Object");
    formData.append("description", "");
    formData.append("spaceId", fleetSpaceId);

    await instanceFleet.post("space/file/mesh", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  };

  const exportGLB = () => {
    const exportRoot = new THREE.Group();
    scene.traverse((child) => {
      if (child.userData?.exportToGLB === true) {
        exportRoot.add(child.clone(true));
      }
    });
    const exporter = new GLTFExporter();
    const options = { binary: true, embedImages: true };
    exporter.parse(
      exportRoot,
      (result) => {
        if (result instanceof ArrayBuffer) {
          const blob = new Blob([result], { type: "model/gltf-binary" });

          if (exportType == "glb") {
            const link = document.createElement("a");
            link.style.display = "none";
            document.body.appendChild(link);
            link.href = URL.createObjectURL(blob);
            link.download = "scene.glb";
            link.click();
            document.body.removeChild(link);
          }

          if (exportType == "fleet") {
            uploadFleet(blob);
          }
        } else {
          console.error("GLB export failed: unexpected result", result);
        }
      },
      (error) => {
        console.error("An error occurred during export", error);
      },
      options
    );
  };
  return null;
}

export function Space() {
  const areas = useAreaStore((state) => state.areas);
  const [realCenter, setRealCenter] = useState<any>();
  const center = useAreaStore((state) => state.center);
  const [roadCount, setRoadCount] = useState(0);
  const [treeCount, setTreeCount] = useState(0);
  const refLat = (center[1].lat + center[0].lat) / 2;
  const refLng = (center[1].lng + center[0].lng) / 2;

  const areaWidth = Math.max(
    Math.abs((center[0].lng - center[1].lng) * scale * Math.cos((refLat * Math.PI) / 180)),
    Math.abs((center[0].lat - center[1].lat) * scale),
    20
  );
  const groundSize = Math.max(areaWidth * 4, 800);
  const cameraDistance = Math.max(120, areaWidth * 0.75);
  const cameraFar = Math.max(7000, areaWidth * 10);

  function project(lat: number, lng: number) {
    const x = (lng - refLng) * scale * Math.cos((refLat * Math.PI) / 180);
    const y = (lat - refLat) * scale;
    return new THREE.Vector2(x, y);
  }

  const areaData = () => {
    const result: Array<{
      shape: THREE.Shape;
      extrudeSettings: any;
      tags: any;
    }> = [];
    areas.forEach((bld: any) => {
      if (!bld.geometry || bld.geometry.length < 3) return;
      const shapePoints = bld.geometry.map((pt: any) => project(pt.lat, pt.lng));
      if (!shapePoints[0].equals(shapePoints[shapePoints.length - 1]))
        shapePoints.push(shapePoints[0]);
      const shape = new THREE.Shape(shapePoints);
      let heightValue = parseFloat(bld.tags.height || "");
      const heightLevels = parseFloat(bld.tags["building:levels"] || "");
      if (isNaN(heightValue)) heightValue = 16;
      if (!isNaN(heightLevels)) heightValue = Math.max(heightValue, heightLevels * 3);
      const extrudeSettings = {
        steps: 1,
        depth: Math.max(heightValue, 12),
        bevelEnabled: false,
      };
      result.push({ shape, extrudeSettings, tags: bld.tags });
    });
    return result;
  };

  useEffect(() => {
    setRealCenter(center);
  }, [center]);

  const buildingsData = areaData();

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: "1rem",
          left: "1rem",
          zIndex: 10,
          padding: "0.9rem 1rem",
          background: "rgba(6, 12, 24, 0.88)",
          color: "#fff",
          borderRadius: "12px",
          fontSize: "0.9rem",
          pointerEvents: "none",
          minWidth: "180px",
        }}
      >
        <div style={{ marginBottom: "0.4rem", fontWeight: 700 }}>Scene info</div>
        <div>Buildings: {buildingsData.length}</div>
        <div>Roads: {roadCount}</div>
        <div>Trees: {treeCount}</div>
        <div>Area width: {Math.round(areaWidth)}</div>
      </div>
      <Canvas shadows camera={{ fov: 55, position: [0, cameraDistance, cameraDistance * 1.1], near: 0.1, far: cameraFar }}>
        <ambientLight intensity={0.6} />
        <directionalLight
          castShadow
          position={[15, 20, 10]}
          intensity={1.2}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-near={0.5}
          shadow-camera-far={100}
          shadow-camera-left={-30}
          shadow-camera-right={30}
          shadow-camera-top={30}
          shadow-camera-bottom={-30}
        />
        <pointLight position={[-10, 15, -10]} intensity={0.5} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow userData={{ exportToGLB: true }}>
          <planeGeometry args={[groundSize, groundSize]} />
          <meshStandardMaterial color="#22272f" roughness={0.85} metalness={0.05} />
        </mesh>

        {buildingsData.map((item, index) => (
          <Building
            key={index}
            shape={item.shape}
            extrudeSettings={item.extrudeSettings}
            tags={item.tags}
          />
        ))}

        <Roads
          area={realCenter}
          onCounts={(roadCount, treeCount) => {
            setRoadCount(roadCount);
            setTreeCount(treeCount);
          }}
        />
        <Car />
        <Export />
        <Sky distance={450000} sunPosition={[0, 1, 0]} inclination={0.35} azimuth={0.1} />
        <Environment preset="city" />
        <OrbitControls makeDefault />
        <ContactShadows position={[0, -0.001, 0]} opacity={0.4} scale={groundSize * 0.75} blur={1.5} far={5} />
      </Canvas>
    </div>
  );
}
