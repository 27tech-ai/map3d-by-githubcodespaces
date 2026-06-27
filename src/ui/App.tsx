import { css, keyframes } from "@emotion/react";
import { Space } from "../three/Space";
import { FullscreenModal } from "../components/FullscreenModal";
import { Title } from "@/components/text/Title";
import { Description } from "@/components/text/Description";
import { Column } from "@/components/flex/Column";
import { MapComponent } from "@/components/map/SelectMap";
import { useEffect, useState } from "react";
import {
  Button,
  NextButton,
  PrevButton,
} from "@/components/button/BottomButton";
import { BuildingHeights, Building } from "@/components/map/Processing";
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { useAreaStore } from "@/state/areaStore";
import { useActionStore } from "@/state/exportStore";
import { Modal } from "@/components/modal/Modal";
import { TopNav } from "@/components/nav/TopNav";
import { getCookie } from "@/utils/cookie";
import { Row } from "@/components/flex/Row";
import instanceFleet from "@/api/axios";

const IconSize = css({
  width: "14px",
  height: "14px",
});

const spinAnimation = keyframes`
from { transform: rotate(0deg); }
to { transform: rotate(360deg); }
`;

function App() {
  const [isNextButtonDisabled, setIsNextButtonDisabled] = useState(true);
  const [areaData, setAreaData] = useState([]);
  const [steps, setSteps] = useState(["front", "processing", "view"]);
  const [step, setStep] = useState(0);
  const [isWarnModal, setIsWarnModal] = useState(false);
  const [isExportModal, setIsExportModal] = useState(false);
  const [isFleetLogin, setIsFleetLogin] = useState(false);
  const [isFleetModal, setIsFleetModal] = useState(false);
  const [spaceList, setSpaceList] = useState([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [isFetchingBuildings, setIsFetchingBuildings] = useState(false);
  const [hasFetchedBuildings, setHasFetchedBuildings] = useState(false);

  const setCenter = useAreaStore((state) => state.setCenter);
  const appendAreas = useAreaStore((state) => state.appendAreas);
  const setAction = useActionStore((state) => state.setAction);
  const setFleet = useActionStore((state) => state.setFleet);

  const overpassEndpoints = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
  ];

  const fetchOverpass = async (query: string) => {
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
  };

  const checkIsBig = () => {
    const a = areaData[0].lat - areaData[1].lat;
    const b = areaData[0].lng - areaData[1].lng;

    console.log(a + b);

    if (a + b > 0.1) {
      return true;
    } else {
      return false;
    }
  };

  const exportFile = () => {
    setAction(true);
  };

  const exportFleet = () => {
    setAction(true);
  };

  const getFleetSpaces = async () => {
    const getSpace: any = await instanceFleet.get("space");

    setSpaceList([
      ...getSpace.data.spaces.map((item) => {
        return {
          ...item,
          key: item.id,
        };
      }),
    ]);
  };

  const putGlbOnFleetSpace = (spaceId) => {
    setFleet(spaceId, "fleet");
    setTimeout(() => {
      exportFleet();
    }, 100);
  };

  const loadFleetSpace = () => {
    getFleetSpaces();
    setIsFleetModal(true);
  };

  const checkFleetLogin = () => {
    try {
      const isCookie = getCookie("token");
      if (isCookie) {
        setIsFleetLogin(true);
      }
    } catch (error) {}
  };

  const handleDone = (data) => {
    setAreaData(data);
    setCenter(data);
    console.log(data, "AAEE");
    setIsNextButtonDisabled(false);
    setBuildings([]);
    setHasFetchedBuildings(false);
  };

  const handleRemove = () => {
    setAreaData([]);
    setIsNextButtonDisabled(true);
    setBuildings([]);
    setHasFetchedBuildings(false);
  };

  const requestBuildings = async () => {
    setIsFetchingBuildings(true);

    const south = areaData[1].lat;
    const west = areaData[1].lng;
    const north = areaData[0].lat;
    const east = areaData[0].lng;
    const query = `[out:json][timeout:25];(way["building"]( ${south},${west},${north},${east} );relation["building"]( ${south},${west},${north},${east} ););out body geom;`;
    try {
      const data = await fetchOverpass(query);
      const blds: Building[] = data.elements.map((element) => ({
        id: element.id,
        tags: element.tags,
        geometry: element.geometry
          ? element.geometry.map((pt) => ({ lat: pt.lat, lng: pt.lon }))
          : undefined,
      }));
      setBuildings(blds);
      appendAreas(blds);
      setHasFetchedBuildings(true);
    } catch (error) {
      console.error("Error fetching building data:", error);
    } finally {
      setIsFetchingBuildings(false);
    }
  };

  const handleClickNextStep = async () => {
    if (step == 0 && checkIsBig()) {
      setIsWarnModal(true);
      return false;
    }

    if (step == 1) {
      if (!hasFetchedBuildings) {
        await requestBuildings();
      }
      setStep(2);
      return;
    }

    setStep(step + 1);
  };

  const handleClickPrevStep = () => {
    setStep(step - 1);
  };

  const handleClickExport = () => {
    setIsExportModal(true);
  };

  useEffect(() => {
    checkFleetLogin();
  }, []);

  return (
    <div css={css({ height: "100%", width: "100%" })}>
      <TopNav step={step} />

      <FullscreenModal isOpen={steps[step] == "front"}>
        <Column gap="1rem">
          <Column gap="0.5rem">
            <Title>Generate 3d map</Title>
            <Description>
              Tools to create 3D maps based on maps and export them in GLB
              format
            </Description>
          </Column>
          <MapComponent
            onRemove={handleRemove}
            onDone={handleDone}
          ></MapComponent>
        </Column>
      </FullscreenModal>

      <FullscreenModal isOpen={steps[step] == "processing"}>
        <Column gap="1rem">
          <Column gap="0.5rem">
            <Title>Processing</Title>
            <Description>
              Click Next Step to fetch building information. Once loaded, click
              Next Step again to view the 3D scene.
            </Description>

            <BuildingHeights
              buildings={buildings}
              loading={isFetchingBuildings}
            />
          </Column>
        </Column>
      </FullscreenModal>

      <PrevButton isShow={step != 0} onClick={handleClickPrevStep}>
        <ChevronLeft css={IconSize} /> Prev Step
      </PrevButton>

      <NextButton
        isShow={step != 2}
        disabled={isNextButtonDisabled || isFetchingBuildings}
        onClick={handleClickNextStep}
      >
        {isFetchingBuildings ? (
          <>
            <Loader2
              css={[
                IconSize,
                css({ animation: `${spinAnimation} 1s linear infinite` }),
              ]}
            />
            Fetching...
          </>
        ) : (
          <>
            Next Step <ChevronRight css={IconSize} />
          </>
        )}
      </NextButton>

      <NextButton isShow={step == 2} onClick={handleClickExport}>
        Export GLB <Download css={IconSize} />
      </NextButton>

      <Modal isOpen={isWarnModal} onClose={() => setIsWarnModal(false)}>
        <Column gap="0.5rem">
          <Title>The area is too big </Title>
          <Description>Do you want to proceed?</Description>
          <Button
            isShow={step != 2}
            disabled={isNextButtonDisabled}
            onClick={() => {
              setStep(step + 1);
              setIsWarnModal(false);
            }}
          >
            Next Step <ChevronRight css={IconSize} />
          </Button>
        </Column>
      </Modal>

      <Modal isOpen={isExportModal} onClose={() => setIsExportModal(false)}>
        <Column gap="0.5rem">
          <Title>Export</Title>

          <Row gap="0.5rem">
            <Button isShow={true} onClick={exportFile}>
              GLB Download <Download css={IconSize} />
            </Button>

            {/* {isFleetLogin ? (
              <Button isShow={true} onClick={loadFleetSpace}>
                Fleet Interlock
              </Button>
            ) : (
              <Button
                isShow={true}
                onClick={() => window.open("https://fleet.im/auth")}
              >
                Fleet Login
              </Button>
            )} */}
          </Row>
        </Column>
      </Modal>

      <Modal isOpen={isFleetModal} onClose={() => setIsFleetModal(false)}>
        <Column gap="0.5rem">
          <Title>Select Fleet Space</Title>
          {spaceList.map((item, index) => (
            <Button isShow={true} onClick={() => putGlbOnFleetSpace(item.id)}>
              {item.title}
            </Button>
          ))}
        </Column>
      </Modal>

      {step === 2 ? <Space /> : null}
    </div>
  );
}

export default App;
