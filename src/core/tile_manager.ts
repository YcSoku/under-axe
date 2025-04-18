import { mat4, vec3 } from 'gl-matrix'
import { Map } from 'mapbox-gl'
import { Frustum } from '../geometry/frustum'
import { Aabb } from '../geometry/aabb'
import { BaseTile } from '../util/tile_id'
import MercatorCoordinate from '../util/mercator_coordinate'
import { tileAABB } from '../util/tile_util'


/////// Const //////////////////////////////////
const NUM_WORLD_COPIES = 3
const defaultConfig = {
    maxZoom: 24,
    minZoom: 0,
    elevationMode: false,
}
type TileManagerConfig = Partial<typeof defaultConfig>

type QuadTileNode = {
    wrap: number;
    x: number;
    y: number;
    z: number;
    aabb: Aabb;
    maxAltitude: number;
    minAltitude: number;
    fullyVisible: boolean;
    shouldSplit?: boolean;
};
type CoveringTileNode = {
    x: number;
    y: number;
    z: number;
    distance: number; // distance to camera
}


export default class TileManager {
    // Base
    type: 'custom' = 'custom'
    id: string = 'tile_manager'
    renderingMode: '2d' | '3d' = '3d'
    log: boolean = false

    // Options
    minzoom: number
    maxzoom: number
    elevationMode: Boolean

    // Core-Properties
    private _map: Map
    frustum!: Frustum

    constructor(map: Map, config: TileManagerConfig) {
        this._map = map

        const options = Object.assign({}, defaultConfig, config)
        this.elevationMode = options.elevationMode
        this.minzoom = options.minZoom
        this.maxzoom = options.maxZoom
    }

    onAdd(_: Map, __: WebGL2RenderingContext) {
        console.log('TileManager added !', this._map)
    }

    render(_: WebGL2RenderingContext, __: Array<number>) {

        const tiles = this.coveringTile()
        console.log(tiles)
        // const z = Math.max(
        //     0,
        //     Math.floor(
        //         transform.zoom +
        //             scaleZoom(transform.tileSize / transform.tileSize),
        //     ),
        // )
        // const centerCoord = transform.locationCoordinate(transform.center)
        // const centerLatitude = transform.center.lat
        // const numTiles = 1 << z
        // const meterToTile =
        //     numTiles * mercatorZfromAltitude(1, transform.center.lat)
        // const centerPoint = [
        //     numTiles * centerCoord.x,
        //     numTiles * centerCoord.y,
        //     0,
        // ]
        // const isGlobe = transform.projection.name === 'globe'
        // const zInMeters = !isGlobe
        // const cameraFrustum = Frustum.fromInvProjectionMatrix(
        //     invProjMatrix,
        //     transform.worldSize,
        //     z,
        //     zInMeters,
        // )
        // const cameraCoord = transform.pointCoordinate(
        //     transform.getCameraPoint(),
        // )
        // const cameraAltitude =
        //     transform._camera.position[2] /
        //     mercatorZfromAltitude(1, transform.center.lat)
        // const cameraPoint = [
        //     numTiles * cameraCoord.x,
        //     numTiles * cameraCoord.y,
        //     cameraAltitude * (zInMeters ? 1 : meterToTile),
        // ]
        // const verticalFrustumIntersect = true

        // const maxRange = 100
        // const minRange = -maxRange
    }

    coveringTile(): Array<any> {

        /////// 01.Basic variables //////////////////////////////////
        const transform = this._map.transform
        let mapZoom = transform.zoom
        if (mapZoom < this.minzoom) return []
        if (mapZoom > this.maxzoom) mapZoom = this.maxzoom
        const minTileZoom = 0
        const maxTileZoom = Math.floor(transform.zoom)
        const worldSize_wd = 1 << maxTileZoom
        const elevationMode = this.elevationMode

        let minElevation = 0,
            maxElevation = 0
        if (elevationMode) {
            maxElevation = 1000 * 6000 // 6000 km, less than 6371 km
            minElevation = -maxElevation
        }

        /////// 02.Map Center //////////////////////////////////
        // lnglat-space | webmercator-space |  WD-space
        const mapCenter_lnglat = [transform._center.lng, transform._center.lat]
        const mapCenter_wmc = MercatorCoordinate.fromLngLat(mapCenter_lnglat)
        const mapCenter_wd = [
            mapCenter_wmc[0] * worldSize_wd,
            mapCenter_wmc[1] * worldSize_wd,
            0.0,
        ]
        const mapCenterAltitude = 0.0 // temp!


        /////// 03.Z-Axis //////////////////////////////////
        const meter2wmcz = MercatorCoordinate.mercatorZfromAltitude(
            1,
            mapCenter_lnglat[1],
        ) // meter to wmc-z
        const wmcz2meter = 1.0 / meter2wmcz // wmc-z to meter
        const meter2wdz = worldSize_wd * meter2wmcz // meter -> WD-z

        /////// 04.Camera-Pos //////////////////////////////////
        const cameraPos_wmc = transform.getFreeCameraOptions().position
        if (!cameraPos_wmc) return []
        const cameraAltitude = cameraPos_wmc.z * wmcz2meter
        const cameraPos_wd = [
            worldSize_wd * cameraPos_wmc.x,
            worldSize_wd * cameraPos_wmc.y,
            cameraAltitude,
        ]
        const cameraHeight = (cameraAltitude - mapCenterAltitude) * meter2wdz; // in pixel coordinates.

        /////// 05.Frustum  //////////////////////////////////
        const { invProjMatrix } = getMatrices(transform, -100.0)!
        this.frustum = Frustum.fromInvViewProjection(
            invProjMatrix,
            transform.worldSize,
            maxTileZoom,
        )

        if (!invProjMatrix) {
            console.warn('🤗挑战不可能！')
            return []
        }

        if (this.log) {
            console.log("===== in WD-Space =====")
            console.log(mapCenter_wd)
            console.log(cameraPos_wd)
            console.log(this.frustum)
        }

        /////// 06.Tile-Picking //////////////////////////////////
        const stack: QuadTileNode[] = [];
        let coveringTilesList: CoveringTileNode[] = [];
        // if (transform.renderWorldCopies) {
        //     for (let i = 1; i <= NUM_WORLD_COPIES; i++) {
        //         stack.push(rootTileNode(-i));
        //         stack.push(rootTileNode(i));
        //     }
        // }
        stack.push(rootTileNode(0))

        while (stack.length > 0) {

            const node = stack.pop()!;
            const x = node.x;
            const y = node.y;
            const z = node.z;
            let fullyVisible = node.fullyVisible;

            // Step 1: 进行相交检测, 看节点是否完全可见
            if (!fullyVisible) {

                const intersect = this.elevationMode ?
                    node.aabb.intersects(this.frustum) :
                    node.aabb.intersectsFlat(this.frustum)

                if (intersect === 0) continue // 该瓦片完全不可见，放弃

                fullyVisible = intersect === 2 // Aabb完全包含于frustum
            }

            // Step 2: 如果已到 maxTileZoom， 或瓦片距相机太远，不再细分，收集此瓦片
            if (z === maxTileZoom || !shouldNodeSplit(node)) {

                if (this.minzoom > z) continue;

                // const dx = centerPoint[0] - ((0.5 + x + (it.wrap << it.zoom)) * (1 << (z - it.zoom)));
                const dx = mapCenter_wd[0] - 0.5 - x - (node.wrap << z);
                const dy = mapCenter_wd[1] - 0.5 - y;

                const cvTileNode = {
                    x, y, z,
                    distance: Math.sqrt(dx * dx + dy * dy),
                } as CoveringTileNode

                coveringTilesList.push(cvTileNode)

                continue
            }
            // Step 2: 
            for (let i = 0; i < 4; i++) {
                /*   ————————————
                    |  0  |  1  |
                    ————————————
                    |  2  |  3  |
                    ————————————  */
                const childX = (x << 1) + (i % 2);
                const childY = (y << 1) + (i >> 1);

                const aabb = node.aabb.quadrant(i)
                const child: QuadTileNode = {
                    x: childX,
                    y: childY,
                    z: z + 1,
                    aabb: aabb,
                    maxAltitude: maxElevation,
                    minAltitude: minElevation,
                    fullyVisible: fullyVisible,
                    shouldSplit: undefined,
                    wrap: node.wrap,
                }

                stack.push(child);
            }

        }

        // sort by distance
        const cover = coveringTilesList.sort((a, b) => a.distance - b.distance).map((n)=>{
            return `${n.z}-${n.x}-${n.y}`
        })

        return cover


        // local helper ////////////////////////////////////
        function rootTileNode(warp: number): QuadTileNode {
            return {
                x: 0,
                y: 0,
                z: 0,
                wrap: warp,
                aabb: tileAABB(worldSize_wd, 0, 0, 0, 0, minElevation, maxElevation),
                maxAltitude: minElevation,
                minAltitude: maxElevation,
                fullyVisible: false,
            } as QuadTileNode
        }

        function shouldNodeSplit(node: QuadTileNode): boolean {
            if (node.z < minTileZoom) return true
            if (node.z >= maxTileZoom) return false
            if (node.shouldSplit != null) return node.shouldSplit


            const camera2corner: vec3 = [0, 0, 0];
            const closestCornerPoint = node.aabb.closestPoint(mapCenter_wd as vec3)
            vec3.sub(camera2corner, closestCornerPoint, cameraPos_wd as vec3)
            camera2corner[2] = elevationMode ? camera2corner[2] * meter2wdz : cameraHeight

            const closestDistance = vec3.dot(camera2corner, transform._camera.forward())

            let distToSplit = (1 << maxTileZoom - node.z) // default
            // let distToSplit = (1 << maxTileZoom - node.z - 1) // lazy mode
            // let distToSplit = (1 << maxTileZoom - node.z + 1) // hurry mode

            if (closestDistance < distToSplit) {
                return true;
            }
            // Border case: with tilt of 85 degrees, center could be outside max zoom distance, due to scale.
            // Ensure max zoom tiles over center.
            const closestPointToCenter = node.aabb.closestPoint(mapCenter_wd as vec3);
            return (closestPointToCenter[0] === mapCenter_wd[0] && closestPointToCenter[1] === mapCenter_wd[1]);

            // const closestElevation = Math.abs(camera2corner[2])

            // for (const corner of corners) {
            //     // distanceXyz: 由相机指向瓦片中心的向量
            //     vec3.sub(camera2corner, corner, cameraPos_wd as vec3);

            //     camera2corner[2] = elevationMode ? camera2corner[2] * meter2wdz : cameraHeight

            //     // 由相机指向瓦片中心的向量，和相机的视线方向做点积，得到相机到瓦片中心的距离在相机视线方向上的投影距离
            //     const dist = vec3.dot(camera2corner, transform._camera.forward());
            //     if (dist < closestDistance) {
            //         closestDistance = dist;
            //         closestElevation = Math.abs(camera2corner[2]);
            //     }
            // }
        }
    }
}
// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function encodeFloatToDouble(value: number) {
    const result = new Float32Array(2)
    result[0] = value

    const delta = value - result[0]
    result[1] = delta
    return result
}

function getMatrices(t: any, minElevation: number = -800.0) {
    if (!t.height) return

    t._updateCameraState()

    const offset = t.centerOffset

    // Z-axis uses pixel coordinates when globe mode is enabled
    const pixelsPerMeter = t.pixelsPerMeter

    const _farZ = farthestPixelDistanceOnPlane(t, minElevation, pixelsPerMeter)

    // The larger the value of nearZ is
    // - the more depth precision is available for features (good)
    // - clipping starts appearing sooner when the camera is close to 3d features (bad)
    //
    // Smaller values worked well for mapbox-gl-js but deckgl was encountering precision issues
    // when rendering it's layers using custom layers. This value was experimentally chosen and
    // seems to solve z-fighting issues in deckgl while not clipping buildings too close to the camera.
    t._nearZ = t.height / 50

    const zUnit = t.projection.zAxisUnit === 'meters' ? pixelsPerMeter : 1.0
    const worldToCamera = t._camera.getWorldToCamera(t.worldSize, zUnit)

    let cameraToClip

    // Projection matrix
    const cameraToClipPerspective = t._camera.getCameraToClipPerspective(
        t._fov,
        t.width / t.height,
        t._nearZ,
        _farZ,
    )
    // Apply offset/padding
    cameraToClipPerspective[8] = (-offset.x * 2) / t.width
    cameraToClipPerspective[9] = (offset.y * 2) / t.height

    if (t.isOrthographic) {
        const cameraToCenterDistance =
            ((0.5 * t.height) / Math.tan(t._fov / 2.0)) * 1.0

        // Calculate bounds for orthographic view
        let top = cameraToCenterDistance * Math.tan(t._fov * 0.5)
        let right = top * t.aspect
        let left = -right
        let bottom = -top
        // Apply offset/padding
        right -= offset.x
        left -= offset.x
        top += offset.y
        bottom += offset.y

        cameraToClip = t._camera.getCameraToClipOrthographic(
            left,
            right,
            bottom,
            top,
            t._nearZ,
            _farZ,
        )
    } else {
        cameraToClip = cameraToClipPerspective
    }

    let m = mat4.multiply([] as any, cameraToClip, worldToCamera)

    // The mercatorMatrix can be used to transform points from mercator coordinates
    // ([0, 0] nw, [1, 1] se) to GL coordinates. / zUnit compensates for scaling done in worldToCamera.
    const mercatorMatrix = mat4.scale([] as any, m, [
        t.worldSize,
        t.worldSize,
        t.worldSize / zUnit,
    ])
    const projMatrix: mat4 = mat4.copy([] as any, m)
    const invProjMatrix = mat4.invert(
        new Float64Array(16) as unknown as mat4,
        projMatrix,
    )

    return {
        mercatorMatrix: mercatorMatrix,
        projMatrix: projMatrix,
        invProjMatrix: invProjMatrix,
    }
}

function clamp(x: number, min: number, max: number): number {
    return Math.min(Math.max(x, min), max)
}

function smoothstep(e0: number, e1: number, x: number) {
    x = clamp((x - e0) / (e1 - e0), 0, 1)
    return x * x * (3 - 2 * x)
}

function farthestPixelDistanceOnPlane(
    tr: any,
    minElevation: number,
    pixelsPerMeter: number,
) {
    // Find the distance from the center point [width/2 + offset.x, height/2 + offset.y] to the
    // center top point [width/2 + offset.x, 0] in Z units, using the law of sines.
    // 1 Z unit is equivalent to 1 horizontal px at the center of the map
    // (the distance between[width/2, height/2] and [width/2 + 1, height/2])
    const fovAboveCenter = tr.fovAboveCenter

    // Adjust distance to MSL by the minimum possible elevation visible on screen,
    // this way the far plane is pushed further in the case of negative elevation.
    const minElevationInPixels = minElevation * pixelsPerMeter
    const cameraToSeaLevelDistance =
        (tr._camera.position[2] * tr.worldSize - minElevationInPixels) /
        Math.cos(tr._pitch)
    const topHalfSurfaceDistance =
        (Math.sin(fovAboveCenter) * cameraToSeaLevelDistance) /
        Math.sin(Math.max(Math.PI / 2.0 - tr._pitch - fovAboveCenter, 0.01))

    // Calculate z distance of the farthest fragment that should be rendered.
    const furthestDistance =
        Math.sin(tr._pitch) * topHalfSurfaceDistance + cameraToSeaLevelDistance
    const horizonDistance = cameraToSeaLevelDistance * (1 / tr._horizonShift)

    // Add a bit extra to avoid precision problems when a fragment's distance is exactly `furthestDistance`
    return Math.min(furthestDistance * 1.01, horizonDistance)
}

function getProjectionInterpolationT(
    projection: any,
    zoom: number,
    width: number,
    height: number,
    maxSize = Infinity,
) {
    const range = projection.range
    if (!range) return 0

    const size = Math.min(maxSize, Math.max(width, height))
    // The interpolation ranges are manually defined based on what makes
    // sense in a 1024px wide map. Adjust the ranges to the current size
    // of the map. The smaller the map, the earlier you can start unskewing.
    const rangeAdjustment = Math.log(size / 1024) / Math.LN2
    const zoomA = range[0] + rangeAdjustment
    const zoomB = range[1] + rangeAdjustment
    const t = smoothstep(zoomA, zoomB, zoom)
    return t
}

function makePerspectiveMatrix(
    fovy: number,
    aspect: number,
    near: number,
    far: number,
) {
    const f = 1.0 / Math.tan(fovy / 2)
    const nf = 1 / (near - far)

    return [
        f / aspect,
        0,
        0,
        0,
        0,
        f,
        0,
        0,
        0,
        0,
        (far + near) * nf,
        -1,
        0,
        0,
        2 * far * near * nf,
        0,
    ]
}

function updateWorldCamera(
    transform: any,
    mercatorWorldSize: number,
    minElevation = -30.0,
) {
    const fov = transform._fov
    const halfFov = transform._fov / 2

    const angle = transform.angle
    const pitch = transform._pitch

    const aspect = transform.width / transform.height

    const cameraToCenterDistance =
        ((((0.5 / Math.tan(halfFov)) * mercatorWorldSize) / transform.scale) *
            transform.height) /
        512.0
    const cameraToSeaLevelDistance =
        (transform._camera.position[2] * mercatorWorldSize - minElevation) /
        Math.cos(pitch)
    const topHalfSurfaceDistance =
        (Math.sin(halfFov) * cameraToSeaLevelDistance) /
        Math.sin(Math.max(Math.PI / 2.0 - pitch - halfFov, 0.01))
    const furthestDistance =
        Math.sin(pitch) * topHalfSurfaceDistance + cameraToSeaLevelDistance
    const horizonDistance = cameraToSeaLevelDistance / transform._horizonShift
    const farZ = Math.min(furthestDistance * 1.01, horizonDistance)
    // const farZ = farthestPixelDistanceOnPlane(transform, -80.06899999999999 * 30.0, transform.pixelsPerMeter)
    const nearZ = transform.height / 50.0

    const pitchMatrix = mat4.rotateX([] as any, mat4.create(), pitch)
    const angleMatrix = mat4.rotateZ([] as any, mat4.create(), angle)
    const worldToCamera = mat4.multiply([] as any, angleMatrix, pitchMatrix)

    const x = transform.pointMerc.x
    const y = transform.pointMerc.y
    const centerX = (x - 0.5) * mercatorWorldSize
    const centerY = (0.5 - y) * mercatorWorldSize
    const center: vec3 = [centerX, centerY, 0]

    const up = vec3.transformMat4([] as any, [0, 1, 0], angleMatrix)
    const position = vec3.add(
        [] as any,
        vec3.scale(
            [] as any,
            vec3.transformMat4([] as any, [0, 0, 1], worldToCamera),
            cameraToCenterDistance,
        ),
        center,
    )

    const view = mat4.invert(
        [] as any,
        mat4.multiply(
            [] as any,
            mat4.translate([] as any, mat4.create(), position),
            worldToCamera,
        ),
    )

    return {
        position,
        center,
        up,
        fov,
        aspect,
        view,
        farZ,
        nearZ,
        // nearZ: cameraToCenterDistance / 200,
    }
}

function scaleZoom(scale: number): number {
    return Math.log(scale) / Math.LN2
}

const earthRadius = 6371008.8
const earthCircumference = 2 * Math.PI * earthRadius
function circumferenceAtLatitude(latitude: number): number {
    return earthCircumference * Math.cos((latitude * Math.PI) / 180)
}
function mercatorZfromAltitude(altitude: number, lat: number): number {
    return altitude / circumferenceAtLatitude(lat)
}
