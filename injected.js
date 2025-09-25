(function () {
    'use strict';

    console.log('🌍', 'Injected script loaded');

    // Constants
    const TARGET_URL      = 'https://backend.wplace.live/s0/pixel/';
    const REQUIRED_PARAMS = ['t', 'coords', 'colors'];

    // Helper functions
    function shouldInterceptRequest(url)
    {
        return typeof url === 'string' && url.startsWith(TARGET_URL);
    }

    function hasRequiredParams(data)
    {
        return REQUIRED_PARAMS.every(param => param in data);
    }

    function isValidReplacementData(data)
    {
        return data &&
               Array.isArray(data.coords) && data.coords.length > 0 &&
               Array.isArray(data.colors) && data.colors.length > 0 &&
               data.coords.length === data.colors.length * 2 &&
               data.coords.length % 2 === 0; // coords must be even (x,y pairs)
    }

    function extractTileCoords(url)
    {
        const match = url.match(/\/s0\/pixel\/(\d+)\/(\d+)/);
        if (match) {
            return {tileX: parseInt(match[1]), tileY: parseInt(match[2])};
        }
        return null;
    }

    function splitCoordsByTiles(coords, colors, baseTileX, baseTileY)
    {
        const tileGroups = new Map();

        // Process coords in pairs (x,y) with corresponding color
        for (let i = 0; i < coords.length; i += 2) {
            const x     = coords[i];
            const y     = coords[i + 1];
            const color = colors[i / 2];

            // Calculate target tile
            const targetTileX = baseTileX + Math.floor(x / 1000);
            const targetTileY = baseTileY + Math.floor(y / 1000);

            // Adjust coordinates to tile-local coordinates
            const localX = x % 1000;
            const localY = y % 1000;

            const tileKey = `${targetTileX},${targetTileY}`;

            if (!tileGroups.has(tileKey)) {
                tileGroups.set(tileKey, {
                    tileX:  targetTileX,
                    tileY:  targetTileY,
                    coords: [],
                    colors: []
                });
            }

            const group = tileGroups.get(tileKey);
            group.coords.push(localX, localY);
            group.colors.push(color);
        }

        return Array.from(tileGroups.values());
    }

    // Helper function to process request body and prompt for replacements
    function processRequestBody(bodyString, requestType, url)
    {
        console.log('🌍', `Original ${requestType} body:`, bodyString);

        let bodyData;
        try {
            bodyData = JSON.parse(bodyString);
        } catch (parseError) {
            console.error('🌍', 'Invalid JSON in request body:', parseError);
            return {success: false, requests: [{url, body: bodyString}]};
        }

        // Check if the required parameters exist
        if (hasRequiredParams(bodyData)) {
            console.log('🌍', 'Found required parameters:', REQUIRED_PARAMS.join(', '));

            // Prompt user for replacement JSON
            const userInput = prompt(
                'Please enter JSON with coords and colors to replace original values:\n\nTiles are 1000x1000 pixels (0-999). Coords ≥1000 will be split to other tiles.\nExample: {"coords": [10,20,1100,300], "colors": [1,2]}');

            if (userInput) {
                try {
                    const replacementData = JSON.parse(userInput);

                    // Validate replacement data
                    if (!isValidReplacementData(replacementData)) {
                        console.error('🌍', 'Invalid replacement data structure');
                        alert(
                            'Invalid data structure. coords and colors must be non-empty arrays and coords count must be exactly double the colors count.');
                        return {success: false, requests: [{url, body: JSON.stringify(bodyData)}]};
                    }

                    // Extract tile coordinates from URL
                    const tileCoords = extractTileCoords(url);
                    if (!tileCoords) {
                        console.error('🌍', 'Could not extract tile coordinates from URL');
                        return {success: false, requests: [{url, body: JSON.stringify(bodyData)}]};
                    }

                    // Split coordinates by tiles
                    const tileGroups = splitCoordsByTiles(
                        replacementData.coords,
                        replacementData.colors,
                        tileCoords.tileX,
                        tileCoords.tileY
                    );

                    console.log('🌍', `Split into ${tileGroups.length} tile groups:`, tileGroups);

                    // Create requests for each tile group
                    const requests = tileGroups.map(group => {
                        const newUrl       = url.replace(/\/s0\/pixel\/\d+\/\d+/,
                                                         `/s0/pixel/${group.tileX}/${group.tileY}`);
                        const newBodyData  = {...bodyData};
                        newBodyData.coords = group.coords;
                        newBodyData.colors = group.colors;

                        return {
                            url:  newUrl,
                            body: JSON.stringify(newBodyData)
                        };
                    });

                    return {success: true, requests};

                } catch (parseError) {
                    console.error('🌍', 'Invalid JSON provided by user:', parseError);
                    alert('Invalid JSON format. Request will proceed with original values.');
                }
            } else {
                console.log('🌍', 'User cancelled or provided empty input. Using original values.');
            }
        }

        return {success: false, requests: [{url, body: JSON.stringify(bodyData)}]};
    }

    // Override fetch immediately
    const originalFetch = window.fetch;
    window.fetch        = function (...args) {
        let [url, options] = args;

        // Check if this is a POST request to the target URL
        if (options && options.method === 'POST' && shouldInterceptRequest(url)) {
            console.log('🌍', 'Intercepting fetch request to:', url);

            try {
                if (options.body && typeof options.body === 'string') {
                    const result = processRequestBody(options.body, 'fetch', url);

                    if (result.success && result.requests.length > 1) {
                        console.log('🌍', `Splitting into ${result.requests.length} requests`);

                        // Execute all requests in parallel
                        const promises = result.requests.map(req => {
                            console.log('🌍', `Sending request to: ${req.url}`);
                            return originalFetch.call(this, req.url, {
                                ...options,
                                body: req.body
                            });
                        });

                        return Promise.all(promises).then(responses => {
                            console.log('🌍', `All ${responses.length} requests completed`);
                            return responses[0]; // Return first response for compatibility
                        });
                    } else if (result.requests.length === 1) {
                        // Single request (original or modified)
                        const req = result.requests[0];
                        if (req.url !== url) {
                            console.log('🌍', `Redirecting to: ${req.url}`);
                            return originalFetch.call(this, req.url, {
                                ...options,
                                body: req.body
                            });
                        } else {
                            options.body = req.body;
                        }
                    }
                } else if (options.body && typeof options.body !== 'string') {
                    console.log('🌍', 'Non-string body type, skipping modification');
                }
            } catch (error) {
                console.error('🌍', 'Error modifying request body:', error);
            }
        }

        return originalFetch.apply(this, args);
    };

    // Override XMLHttpRequest
    const originalXHRSend         = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (data) {
        if (this._method === 'POST' && shouldInterceptRequest(this._url)) {
            console.log('🌍', 'Intercepting XHR request to:', this._url);

            try {
                if (data && typeof data === 'string') {
                    const result = processRequestBody(data, 'XHR', this._url);

                    if (result.success && result.requests.length > 1) {
                        console.log('🌍', `Splitting XHR into ${result.requests.length} requests`);

                        // Execute all requests sequentially for XHR compatibility
                        const executeRequests = async () => {
                            for (const req of result.requests) {
                                console.log('🌍', `Sending XHR request to: ${req.url}`);

                                const xhr = new XMLHttpRequest();
                                xhr.open('POST', req.url);

                                // Copy headers from original request if available
                                if (this.getRequestHeader) {
                                    // Note: getRequestHeader is not a standard method
                                    // This is a simplified approach
                                }

                                xhr.send(req.body);
                            }
                        };

                        executeRequests().catch(error => {
                            console.error('🌍', 'Error executing split XHR requests:', error);
                        });

                        return; // Don't send original request
                    } else if (result.requests.length === 1) {
                        const req = result.requests[0];
                        if (req.url !== this._url) {
                            console.log('🌍', `Redirecting XHR to: ${req.url}`);
                            // For XHR, we need to handle URL change differently
                            console.warn('🌍', 'XHR URL redirect not fully supported - may need page reload');
                        }
                        data = req.body;
                    }
                }
            } catch (error) {
                console.error('🌍', 'Error modifying XHR body:', error);
            }
        }

        return originalXHRSend.call(this, data);
    };

    // Track XMLHttpRequest open calls
    const originalXHROpen         = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        this._method = method;
        this._url    = url;
        return originalXHROpen.apply(this, arguments);
    };

    console.log('🌍', 'Request interceptor ready');
})();