import asyncio
import io
import pathlib
import shutil
from contextlib import aclosing

import pytest
from fontTools.ttLib import TTFont

from fontra.backends import getFileSystemBackend, opentype
from fontra.core.classes import (
    Axes,
    CrossAxisMapping,
    FontAxis,
    FontSource,
    LineMetric,
    VariableGlyph,
)
from fontra.core.fonthandler import FontHandler
from fontra.filesystem.projectmanager import FileSystemProjectManager

opentype._USE_SOURCE_INDEX_INSTEAD_OF_UUID = True

dataDir = pathlib.Path(__file__).resolve().parent / "data"


@pytest.fixture
def testFontMutatorSans():
    return getFileSystemBackend(dataDir / "mutatorsans" / "MutatorSans.ttf")


@pytest.fixture
def testFontAvar2():
    return getFileSystemBackend(dataDir / "avar2" / "DemoAvar2.ttf")


@pytest.fixture
def testFontAvar2NLI():
    return getFileSystemBackend(dataDir / "avar2" / "DemoAvar2-NLI.ttf")


expectedAxes = Axes(
    axes=[
        FontAxis(
            name="DIAG",
            label="Diagonal",
            tag="DIAG",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=False,
            customData={},
        ),
        FontAxis(
            name="HORI",
            label="Horizontal",
            tag="HORI",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=True,
            customData={},
        ),
        FontAxis(
            name="VERT",
            label="Vertical",
            tag="VERT",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=True,
            customData={},
        ),
    ],
    mappings=[
        CrossAxisMapping(
            description=None,
            groupDescription=None,
            inputLocation={
                "DIAG": 25.0,
            },
            outputLocation={
                "HORI": 0.0,
                "VERT": 33.001708984375,
            },
        ),
        CrossAxisMapping(
            description=None,
            groupDescription=None,
            inputLocation={
                "DIAG": 75.0,
            },
            outputLocation={
                "HORI": 100.0,
                "VERT": 67.00032552083334,
            },
        ),
        CrossAxisMapping(
            description=None,
            groupDescription=None,
            inputLocation={
                "DIAG": 100.0,
            },
            outputLocation={
                "HORI": 100.0,
                "VERT": 100.0,
            },
        ),
    ],
    elidedFallBackname=None,
    customData={},
)


async def test_readAvar2(testFontAvar2):
    axes = await testFontAvar2.getAxes()
    assert expectedAxes == axes


expectedAxesNLI = Axes(
    axes=[
        FontAxis(
            name="BEND",
            label="Bend",
            tag="BEND",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=False,
            customData={},
        ),
        FontAxis(
            name="BND2",
            label="Bend-2",
            tag="BND2",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=True,
            customData={},
        ),
    ],
    mappings=[
        CrossAxisMapping(
            description=None,
            groupDescription=None,
            inputLocation={"BEND": 100},
            outputLocation={"BND2": 100},
        )
    ],
    elidedFallBackname=None,
    customData={},
)


async def test_readAvar2NLI(testFontAvar2NLI):
    axes = await testFontAvar2NLI.getAxes()
    assert expectedAxesNLI == axes


async def test_externalChanges(tmpdir):
    tmpdir = pathlib.Path(tmpdir)
    sourcePath = dataDir / "mutatorsans" / "MutatorSans.subset.ttf"
    destPath = tmpdir / "testfont.ttf"
    shutil.copy(sourcePath, destPath)

    backend = getFileSystemBackend(destPath)
    handler = FontHandler(
        backend=backend,
        projectIdentifier="test",
        metaInfoProvider=FileSystemProjectManager(),
    )

    async with aclosing(handler):
        await handler.startTasks()

        glyph = await handler.getGlyph("A")
        assert glyph.layers["font-source-0"].glyph.xAdvance == 396

        ttFont = TTFont(destPath)
        assert ttFont["hmtx"]["A"] == (396, 20)
        ttFont["hmtx"]["A"] = (999, 20)
        ttFont.save(destPath)

        await asyncio.sleep(0.15)  # give the file watcher a moment to catch up

        modifiedGlyph = await handler.getGlyph("A")

        assert modifiedGlyph.layers["font-source-0"].glyph.xAdvance == 999


async def test_readTTX():
    path = dataDir / "mutatorsans" / "MutatorSans.subset.ttx"
    font = getFileSystemBackend(path)
    glyph = await font.getGlyph("A")
    assert isinstance(glyph, VariableGlyph)


async def test_getShaperFontData_ttf():
    path = dataDir / "mutatorsans" / "MutatorSans.ttf"
    font = getFileSystemBackend(path)
    shaperFontData = await font.getShaperFontData()
    assert shaperFontData is not None
    f = io.BytesIO(shaperFontData.data)
    font = TTFont(f)
    assert sorted(font.keys()) == [
        "GDEF",
        "GPOS",
        "GSUB",
        "GlyphOrder",
        "fvar",
        "head",
        "maxp",
        "name",
        "post",
    ]


async def test_getShaperFontData_ttx():
    path = dataDir / "mutatorsans" / "MutatorSans.subset.ttx"
    font = getFileSystemBackend(path)
    shaperFontData = await font.getShaperFontData()
    assert shaperFontData is not None
    f = io.BytesIO(shaperFontData.data)
    font = TTFont(f)
    assert sorted(font.keys()) == [
        "GDEF",
        "GPOS",
        "GSUB",
        "GlyphOrder",
        "fvar",
        "head",
        "maxp",
        "name",
        "post",
    ]


async def test_getSources(testFontMutatorSans):
    sources = await testFontMutatorSans.getSources()
    assert len(sources) == 4

    expectedSourceValues = [
        FontSource(
            name="LightCondensed",
            lineMetricsHorizontalLayout={
                "ascender": LineMetric(value=700),
                "baseline": LineMetric(value=0),
                "capHeight": LineMetric(value=700),
                "descender": LineMetric(value=-200),
                "xHeight": LineMetric(value=500),
            },
        ),
        FontSource(
            name="wdth=1000",
            location={"wdth": 1000.0},
            lineMetricsHorizontalLayout={
                "ascender": LineMetric(value=700),
                "baseline": LineMetric(value=0),
                "capHeight": LineMetric(value=700),
                "descender": LineMetric(value=-200),
                "xHeight": LineMetric(value=500),
            },
        ),
        FontSource(
            name="wdth=1000,wght=900",
            location={"wdth": 1000.0, "wght": 900.0},
            lineMetricsHorizontalLayout={
                "ascender": LineMetric(value=800),
                "baseline": LineMetric(value=0),
                "capHeight": LineMetric(value=800),
                "descender": LineMetric(value=-200),
                "xHeight": LineMetric(value=500),
            },
        ),
        FontSource(
            name="wght=900",
            location={"wght": 900.0},
            lineMetricsHorizontalLayout={
                "ascender": LineMetric(value=800),
                "baseline": LineMetric(value=0),
                "capHeight": LineMetric(value=800),
                "descender": LineMetric(value=-200),
                "xHeight": LineMetric(value=500),
            },
        ),
    ]
    assert list(sources.values()) == expectedSourceValues


fontSourceNamesTestData = [
    (
        dataDir / "sourcesans" / "SourceSans3VF-Upright.subset.otf",
        ["ExtraLight", "Semibold", "Black"],
    )
]


@pytest.mark.parametrize("fontPath, expectedNames", fontSourceNamesTestData)
async def test_font_sources_names(fontPath, expectedNames):
    font = getFileSystemBackend(fontPath)
    sources = await font.getSources()
    sourceNames = [s.name for s in sources.values()]
    assert sourceNames == expectedNames


async def test_os2_version1():
    # https://github.com/fontra/fontra/issues/2548
    fontPath = dataDir / "noto" / "NotoSans-Regular.subset.os2-version1.otf"
    font = getFileSystemBackend(fontPath)
    sources = await font.getSources()
    assert len(sources) == 1
    [source] = sources.values()
    assert source.lineMetricsHorizontalLayout == {
        "ascender": LineMetric(value=1069),
        "baseline": LineMetric(value=0),
        "descender": LineMetric(value=-293),
    }


kerningTestGlyphs = [".notdef", "A", "Aacute", "T", "V", "W", "Y", "o"]


def buildKerningTestFont(path, featureText):
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(kerningTestGlyphs)
    fb.setupCharacterMap({ord(g): g for g in kerningTestGlyphs if len(g) == 1})
    fb.setupGlyf({g: TTGlyphPen(None).glyph() for g in kerningTestGlyphs})
    fb.setupHorizontalMetrics({g: (500, 0) for g in kerningTestGlyphs})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": "KernTest", "styleName": "Regular"})
    fb.setupOS2()
    fb.setupPost()
    fb.setupFvar([("wght", 100, 400, 900, "Weight")], [])
    fb.addOpenTypeFeatures(featureText)
    fb.save(path)
    return getFileSystemBackend(path)


async def getKerningBySourceLocation(font):
    sources = await font.getSources()
    kerning = (await font.getKerning())["kern"]
    weights = [sources[i].location.get("wght", 400) for i in kerning.sourceIdentifiers]
    values = {
        left: {
            right: dict(zip(weights, sourceValues))
            for right, sourceValues in rightDict.items()
        }
        for left, rightDict in kerning.values.items()
    }
    return kerning, values


async def test_kerning_glyph_pair_variable(tmp_path):
    font = buildKerningTestFont(
        tmp_path / "k.ttf",
        "feature kern { pos A V (wght=100:-60 wght=400:-50 wght=900:-80); } kern;",
    )
    kerning, values = await getKerningBySourceLocation(font)
    assert values == {"A": {"V": {100: -60, 400: -50, 900: -80}}}
    assert kerning.groupsSide1 == {}
    assert kerning.groupsSide2 == {}


async def test_kerning_class_pair(tmp_path):
    font = buildKerningTestFont(
        tmp_path / "k.ttf",
        """
        @L = [A Aacute];
        @R = [V W];
        feature kern {
            pos A o -5;
            pos @L @R (wght=100:-30 wght=400:-20 wght=900:-40);
        } kern;
        """,
    )
    kerning, values = await getKerningBySourceLocation(font)
    assert kerning.groupsSide1 == {"A": ["A", "Aacute"]}
    assert kerning.groupsSide2 == {"V": ["V", "W"]}
    assert values == {
        "A": {"o": {100: -5, 400: -5, 900: -5}},
        "@A": {"@V": {100: -30, 400: -20, 900: -40}},
    }


async def test_kerning_class_shadowed_by_earlier_subtable(tmp_path):
    # A is covered by the first subtable, so the second never applies to it.
    font = buildKerningTestFont(
        tmp_path / "k.ttf",
        """
        @L1 = [A Aacute];
        @L2 = [A T];
        @R = [V W];
        feature kern {
            pos @L1 @R -30;
            subtable;
            pos @L2 @R -10;
        } kern;
        """,
    )
    kerning, values = await getKerningBySourceLocation(font)
    assert kerning.groupsSide1 == {"A": ["A", "Aacute"], "T": ["T"]}
    assert kerning.groupsSide2 == {"V": ["V", "W"]}
    assert values == {
        "@A": {"@V": {400: -30}},
        "@T": {"@V": {400: -10}},
    }


async def test_kerning_second_class_overlaps_earlier_one(tmp_path):
    # V is in a second-side class in both subtables; a glyph can be in one
    # group per side, so the later class keeps V as a single-glyph pair.
    font = buildKerningTestFont(
        tmp_path / "k.ttf",
        """
        @L1 = [A Aacute];
        @R1 = [V W];
        @L2 = [T];
        @R2 = [V Y];
        feature kern {
            pos @L1 @R1 -30;
            subtable;
            pos @L2 @R2 -10;
        } kern;
        """,
    )
    kerning, values = await getKerningBySourceLocation(font)
    assert kerning.groupsSide1 == {"A": ["A", "Aacute"], "T": ["T"]}
    assert kerning.groupsSide2 == {"V": ["V", "W"], "Y": ["Y"]}
    assert values == {
        "@A": {"@V": {400: -30}},
        "@T": {"@Y": {400: -10}, "V": {400: -10}},
    }


async def test_kerning_static_font_has_one_source(tmp_path):
    from fontTools.ttLib import TTFont as _TTFont

    path = tmp_path / "k.ttf"
    buildKerningTestFont(path, "feature kern { pos A V -50; } kern;")
    ttFont = _TTFont(path)
    del ttFont["fvar"]
    ttFont.save(path)
    font = getFileSystemBackend(path)
    kerning = (await font.getKerning())["kern"]
    assert len(kerning.sourceIdentifiers) == 1
    assert kerning.values == {"A": {"V": [-50]}}


def resolveKerningPair(kerning, leftGlyph, rightGlyph):
    # The designspace kerning rule, per master as the compiler applies it:
    # glyph-glyph, then glyph-group, then group-glyph, then group-group.
    def groupOf(groups, glyphName):
        for groupName, glyphNames in groups.items():
            if glyphName in glyphNames:
                return "@" + groupName
        return None

    leftGroup = groupOf(kerning.groupsSide1, leftGlyph)
    rightGroup = groupOf(kerning.groupsSide2, rightGlyph)
    candidates = [
        kerning.values.get(left, {}).get(right)
        for left, right in [
            (leftGlyph, rightGlyph),
            (leftGlyph, rightGroup),
            (leftGroup, rightGlyph),
            (leftGroup, rightGroup),
        ]
    ]
    resolved = []
    for i in range(len(kerning.sourceIdentifiers)):
        found = [c[i] for c in candidates if c is not None and c[i] is not None]
        resolved.append(found[0] if found else 0)
    return resolved


async def test_kerning_matches_mutatorsans_sources(testFontMutatorSans):
    designspace = getFileSystemBackend(
        dataDir / "mutatorsans" / "MutatorSans.designspace"
    )
    dsKerning = (await designspace.getKerning())["kern"]
    dsSources = await designspace.getSources()
    dsSourceIndex = {
        dsSources[identifier].name: i
        for i, identifier in enumerate(dsKerning.sourceIdentifiers)
    }
    # The compiled font names its masters by location, not by style name.
    ttfNameToDsName = {
        "LightCondensed": "LightCondensed",
        "wdth=1000": "LightWide",
        "wght=900": "BoldCondensed",
        "wdth=1000,wght=900": "BoldWide",
    }

    otSources = await testFontMutatorSans.getSources()
    otKerning = (await testFontMutatorSans.getKerning())["kern"]
    dsIndices = [
        dsSourceIndex[ttfNameToDsName[otSources[i].name]]
        for i in otKerning.sourceIdentifiers
    ]

    assert otKerning.groupsSide1 == {}
    assert otKerning.groupsSide2 == {}

    otPairs = {
        (left, right): sourceValues
        for left, rightDict in otKerning.values.items()
        for right, sourceValues in rightDict.items()
    }
    assert len(otPairs) == 88
    for (left, right), sourceValues in otPairs.items():
        expected = resolveKerningPair(dsKerning, left, right)
        assert sourceValues == [expected[i] for i in dsIndices], (left, right)
