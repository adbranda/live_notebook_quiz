#!/bin/bash

rsync -avz --exclude node_modules --exclude .git ./ sueudu@172.221.27.25:/home/sueudu/quiz_anthonybranda_site/
