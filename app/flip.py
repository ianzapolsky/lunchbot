import sys

if len(sys.argv) != 2:
    print("usage: flip <input file>")
    exit(1)

input_file = open(sys.argv[1], "rb")

do_flip = False
prev_line = ""

for line in input_file:
    if do_flip:
        print(line.strip())
        print(prev_line.strip())
        do_flip = False
    else:
        do_flip = True
        prev_line = line

if do_flip:
    print("Error: file does not have even number of lines")

input_file.close()
