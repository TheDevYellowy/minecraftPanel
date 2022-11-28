const { EventEmitter } = require('events');
const { createReadStream, statSync } = require('fs');
const { createInterface } = require('readline');
const { watch } = require('chokidar');
const { decodeStream } = require('iconv-lite');

module.exports = class Tail extends EventEmitter {
    constructor(filePath, encoding = 'utf-8') {
        super();
        this.filePath = filePath;
        this.encode = encoding;
        this.watcher = null;
        this.position = 0;
        this.watch();
    }

    watch() {
        if(this.watcher) return;
        
        const stats = this._getStats();
        if (stats) this.position = stats.size;

        this.watcher = watch(this.filePath, {
            ignoreInitial: true,
            alwaysStat: true,
            awaitWriteFinish: {
                stabilityThreshold: 200,
                pollInterval: 50
            },
        }).on('add', (basename, stats) => {
            if(basename === this.filePath) this._handleFileCreate(stats);
        }).on('change', (basename, stats) => {
            if(basename === this.filePath) this._handleFileUpdate(stats);
        }).on('unlink', (basename) => {
            if(basename === this.filePath) this._handleFileRemove();
        });
    }

    unwatch() {
        if(!this.watcher) return;
        this.watcher.close();
        this.watcher = null;
    }

    _getStats() {
        try {
            statSync(this.filePath);
        } catch (e) {
            return false;
        }
    }

    _handleFileCreate(stats) {
        this.position = 0;
        this._handleFileUpdate(stats);
    }

    _handleFileUpdate(stats) {
        if(stats.size < this.position) this.position = 0;

        if(!stats.size) return;

        createInterface({
            input: createReadStream(this.filePath, {
                start: this.position,
                end: stats.size-1,
            }).pipe(decodeStream(this.encode))
        }).on('line', line => this.emit('line', line));

        this.position = stats.size;
    }

    _handleFileRemove() {
        this.position = 0;
    }
}