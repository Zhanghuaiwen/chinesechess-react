CXX := D:/winlibs-gcc16/mingw64/bin/g++.exe
CXXFLAGS := -std=c++17 -fno-exceptions -O3 -DNDEBUG -DIS_64BIT -DUSE_SSE41 -DUSE_POPCNT -msse4.1 -mpopcnt -I$(SRCROOT) -I$(SRCROOT)/external
LDFLAGS := -static -pthread
SRCROOT := ../Pikafish-master/src
OBJDIR := obj

SRCS := attacks.cpp \
	benchmark.cpp \
	bitboard.cpp \
	engine.cpp \
	evaluate.cpp \
	main.cpp \
	memory.cpp \
	misc.cpp \
	movegen.cpp \
	movepick.cpp \
	position.cpp \
	score.cpp \
	search.cpp \
	thread.cpp \
	timeman.cpp \
	tt.cpp \
	tune.cpp \
	uci.cpp \
	ucioption.cpp \
	nnue/network.cpp \
	nnue/nnue_accumulator.cpp \
	nnue/nnue_misc.cpp \
	nnue/features/full_threats.cpp \
	nnue/features/half_ka_v2_hm.cpp \
	external/common/debug.cpp \
	external/common/entropy_common.cpp \
	external/common/error_private.cpp \
	external/common/fse_decompress.cpp \
	external/common/pool.cpp \
	external/common/threading.cpp \
	external/common/xxhash.cpp \
	external/common/zstd_common.cpp \
	external/decompress/huf_decompress.cpp \
	external/decompress/zstd_ddict.cpp \
	external/decompress/zstd_decompress.cpp \
	external/decompress/zstd_decompress_block.cpp

OBJS := $(addprefix $(OBJDIR)/,$(notdir $(SRCS:.cpp=.o)))
OBJS += $(OBJDIR)/huf_decompress_amd64.o
EXE := Pikafish.exe

all: $(EXE)

$(EXE): $(OBJS)
	$(CXX) $(OBJS) -o $@ $(LDFLAGS)

$(OBJDIR)/%.o: $(SRCROOT)/%.cpp
	@if not exist $(OBJDIR) mkdir $(OBJDIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(OBJDIR)/%.o: $(SRCROOT)/nnue/%.cpp
	@if not exist $(OBJDIR) mkdir $(OBJDIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(OBJDIR)/%.o: $(SRCROOT)/nnue/features/%.cpp
	@if not exist $(OBJDIR) mkdir $(OBJDIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(OBJDIR)/%.o: $(SRCROOT)/external/common/%.cpp
	@if not exist $(OBJDIR) mkdir $(OBJDIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(OBJDIR)/%.o: $(SRCROOT)/external/decompress/%.cpp
	@if not exist $(OBJDIR) mkdir $(OBJDIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(OBJDIR)/huf_decompress_amd64.o: $(SRCROOT)/external/decompress/huf_decompress_amd64.S
	@if not exist $(OBJDIR) mkdir $(OBJDIR)
	$(CXX) -x assembler-with-cpp -c $< -o $@

clean:
	-rmdir /S /Q $(OBJDIR) 2>nul
	-del /Q $(EXE) 2>nul
